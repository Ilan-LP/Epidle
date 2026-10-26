import { BALANCE, type GameState } from "@epidle/core";
import type { FastifyInstance } from "fastify";
import { SESSION_MS } from "./auth";
import type { ClientVersion } from "./client-version";
import type { Db } from "./db";
import { parseState } from "./games";

// Own analytics, in our database: no third party, no IP, no user agent, no pseudo in the output.
// Per player: first and last time seen, the days they were active (for D+1 / D+3 retention) and
// the first time each tier was reached in a season (the funnel). Removing a player removes it all.

/** Days are calendar days in Lyon: a session at 00:30 counts for the day the player lives in. */
export const ANALYTICS_TIME_ZONE = "Europe/Paris";
/** Polling sends a request every 15 s: write at most once a minute per player. */
const WRITE_EVERY_MS = 60_000;

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ANALYTICS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "YYYY-MM-DD" of `ms` in Lyon. */
export const parisDay = (ms: number): string => dayFormat.format(ms);

/** `day` plus `n` calendar days, both "YYYY-MM-DD". */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

export const clientLabel = (client: ClientVersion | null): string =>
  client ? `${client.kind}/${client.version}` : "legacy";

function touch(db: Db, userId: number, at: number, client: string | null) {
  db.prepare(
    `INSERT INTO player_stats (user_id, first_seen, last_seen, client) VALUES (@userId, @at, @at, @client)
     ON CONFLICT (user_id) DO UPDATE SET first_seen = min(first_seen, excluded.first_seen),
       last_seen = max(last_seen, excluded.last_seen),
       client = CASE WHEN excluded.last_seen >= last_seen THEN coalesce(excluded.client, client)
         ELSE client END`,
  ).run({ userId, at, client });
  db.prepare("INSERT OR IGNORE INTO player_days (user_id, day) VALUES (?, ?)").run(
    userId,
    parisDay(at),
  );
}

/** Marks the player as seen at `now`, throttled per player. Returns true if it wrote. */
export function createActivityTracker(db: Db) {
  const last = new Map<number, { at: number; day: string }>();
  return (userId: number, client: ClientVersion | null, now: number): boolean => {
    const day = parisDay(now);
    const prev = last.get(userId);
    if (prev && prev.day === day && now - prev.at < WRITE_EVERY_MS) return false;
    last.set(userId, { at: now, day });
    touch(db, userId, now, clientLabel(client));
    return true;
  };
}

export function registerAnalytics(app: FastifyInstance, db: Db, now: () => number) {
  const track = createActivityTracker(db);
  // After the response: never slows a request down, and a failure only reaches the log.
  app.addHook("onResponse", async (request, reply) => {
    if (!request.user || reply.statusCode >= 400) return;
    try {
      track(request.user.id, request.client, now());
    } catch (e) {
      request.log.error(e, "analytics write failed");
    }
  });
}

/** Tiers reached between two saves of the same company, from the exact unlock times. */
export function recordMilestones(
  db: Db,
  seasonId: number,
  seasonStart: number,
  userId: number,
  before: GameState | null,
  after: GameState,
): void {
  // A first save records tier 0 too: "has a company this season", the top of the funnel.
  for (let tier = before ? before.tier + 1 : 0; tier <= after.tier; tier++) {
    db.prepare(
      "INSERT OR IGNORE INTO milestones (user_id, season_id, tier, at) VALUES (?, ?, ?, ?)",
    ).run(userId, seasonId, tier, seasonStart + (after.tierUnlockedAt[tier] ?? after.time) * 1000);
  }
}

/**
 * Fills the analytics tables from what the database already knew before they existed: account
 * creation, logins (sessions last SESSION_MS), intents of the last 24 h, companies and their tier
 * unlock times. Only adds (INSERT OR IGNORE, min / max): safe to run any number of times.
 */
export function backfillAnalytics(db: Db): void {
  const seen = db
    .prepare(
      `SELECT id AS userId, created_at AS at FROM users
       UNION ALL SELECT user_id, expires_at - ${SESSION_MS} FROM sessions
       UNION ALL SELECT user_id, created_at FROM intent_requests
       UNION ALL SELECT user_id, joined_at FROM games WHERE joined_at IS NOT NULL`,
    )
    .all() as { userId: number; at: number }[];
  for (const { userId, at } of seen) touch(db, userId, at, null);

  const games = db
    .prepare(
      `SELECT g.user_id AS userId, g.season_id AS seasonId, s.starts_at AS startsAt, g.state
       FROM games g JOIN seasons s ON s.id = g.season_id`,
    )
    .all() as { userId: number; seasonId: number; startsAt: number; state: string }[];
  for (const g of games) {
    const state = parseState(g.state);
    if (state) recordMilestones(db, g.seasonId, g.startsAt, g.userId, null, state);
  }
}

export interface AnalyticsReport {
  today: string;
  /** Oldest first. `new`: players whose first active day it is. */
  daily: { day: string; active: number; new: number }[];
  /** By first active day, oldest first. null: that day is not over yet. */
  cohorts: { day: string; players: number; d1: number | null; d3: number | null }[];
  /** Over every cohort old enough, also those before the window. */
  retention: { d1: Rate; d3: Rate };
  funnel: {
    seasonId: number;
    tiers: { tier: number; name: string; unlocks: string | null; players: number }[];
  } | null;
  /** Last client of the players active in the last 7 days. */
  clients: { client: string; players: number }[];
}

export interface Rate {
  retained: number;
  /** Players of the cohorts whose day D+k is over. */
  eligible: number;
}

/** Aggregates only: counts per day, cohort, tier and client version. No pseudo, no id. */
export function analyticsReport(db: Db, now: number, days: number): AnalyticsReport {
  const today = parisDay(now);
  const from = addDays(today, -(days - 1));
  const rows = db.prepare("SELECT user_id AS userId, day FROM player_days").all() as {
    userId: number;
    day: string;
  }[];

  const activeDays = new Map<number, Set<string>>();
  for (const { userId, day } of rows) {
    const set = activeDays.get(userId) ?? new Set<string>();
    set.add(day);
    activeDays.set(userId, set);
  }
  const firstDay = new Map<number, string>();
  for (const [userId, set] of activeDays) firstDay.set(userId, [...set].sort()[0] as string);

  const daily: AnalyticsReport["daily"] = [];
  for (let day = from; day <= today; day = addDays(day, 1)) {
    let active = 0;
    let fresh = 0;
    for (const [userId, set] of activeDays) {
      if (!set.has(day)) continue;
      active++;
      if (firstDay.get(userId) === day) fresh++;
    }
    daily.push({ day, active, new: fresh });
  }

  // D+k: active on the k-th calendar day after the first one. Counted once that day is over.
  const retained = (k: number, cohort: string, users: number[]) =>
    addDays(cohort, k) < today
      ? users.filter((u) => activeDays.get(u)?.has(addDays(cohort, k))).length
      : null;
  const byCohort = new Map<string, number[]>();
  for (const [userId, day] of firstDay) byCohort.set(day, [...(byCohort.get(day) ?? []), userId]);
  const cohorts: AnalyticsReport["cohorts"] = [];
  const retention = { d1: { retained: 0, eligible: 0 }, d3: { retained: 0, eligible: 0 } };
  for (const [day, users] of [...byCohort].sort(([a], [b]) => a.localeCompare(b))) {
    const d1 = retained(1, day, users);
    const d3 = retained(3, day, users);
    if (d1 !== null) retention.d1 = add(retention.d1, d1, users.length);
    if (d3 !== null) retention.d3 = add(retention.d3, d3, users.length);
    if (day >= from) cohorts.push({ day, players: users.length, d1, d3 });
  }

  const season = db.prepare("SELECT max(season_id) AS id FROM milestones").get() as {
    id: number | null;
  };
  let funnel: AnalyticsReport["funnel"] = null;
  if (season.id !== null) {
    const counts = new Map(
      (
        db
          .prepare(
            "SELECT tier, count(*) AS players FROM milestones WHERE season_id = ? GROUP BY tier",
          )
          .all(season.id) as { tier: number; players: number }[]
      ).map((r) => [r.tier, r.players]),
    );
    funnel = {
      seasonId: season.id,
      tiers: BALANCE.tiers.map((t, tier) => ({
        tier,
        name: t.name,
        unlocks: BALANCE.stages.find((s) => s.tier === tier)?.name ?? null,
        players: counts.get(tier) ?? 0,
      })),
    };
  }

  const clients = db
    .prepare(
      `SELECT coalesce(client, 'legacy') AS client, count(*) AS players FROM player_stats
       WHERE last_seen > ? GROUP BY 1 ORDER BY players DESC, client`,
    )
    .all(now - 7 * 24 * 3600_000) as { client: string; players: number }[];

  return { today, daily, cohorts, retention, funnel, clients };
}

const add = (r: Rate, retained: number, eligible: number): Rate => ({
  retained: r.retained + retained,
  eligible: r.eligible + eligible,
});
