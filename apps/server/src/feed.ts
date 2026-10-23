import { BALANCE, type GameState, HOUR, weekIndex } from "@epidle/core";
import type { Db } from "./db";
import type { Season } from "./games";

// "What changed this week": milestones and rank changes, the things people talk about.
// Events are written when a company is saved (tiers, levels) and when scores are refreshed
// (rank changes), and read back for the current week of the season.

export type FeedKind = "tier" | "level" | "lead" | "top10";

/** Tiers below this are reached by everyone in the first hour: not news. */
const FEED_MIN_TIER = 2;
/** "Lead", 17 h of training: the first level worth announcing. */
const FEED_MIN_LEVEL = BALANCE.levels.indexOf("Lead");
const TOP_SIZE = 10;
/** Two players swapping the lead every minute should not flood the feed. */
const LEAD_COOLDOWN_MS = HOUR * 1000;
const TOP10_COOLDOWN_MS = 6 * HOUR * 1000;
const FEED_SIZE = 30;
const CLIMBERS = 5;

function insert(db: Db, season: Season, userId: number, at: number, kind: FeedKind, value: number) {
  db.prepare(
    "INSERT INTO feed_events (season_id, user_id, at, kind, value) VALUES (?, ?, ?, ?, ?)",
  ).run(season.id, userId, Math.round(at), kind, value);
}

const maxLevel = (s: GameState | null) => Math.max(0, ...(s?.devs.map((d) => d.level) ?? []));

/** Tiers and dev levels reached between two saves of the same company. */
export function recordProgress(
  db: Db,
  season: Season,
  userId: number,
  before: GameState | null,
  after: GameState,
): void {
  for (let tier = Math.max((before?.tier ?? 0) + 1, FEED_MIN_TIER); tier <= after.tier; tier++) {
    // The exact unlock time is in the state.
    const at = season.startsAt + (after.tierUnlockedAt[tier] ?? after.time) * 1000;
    insert(db, season, userId, at, "tier", tier);
  }
  const level = maxLevel(after);
  if (level >= FEED_MIN_LEVEL && level > maxLevel(before)) {
    insert(db, season, userId, season.startsAt + after.time * 1000, "level", level);
  }
}

function recent(db: Db, userId: number, kind: FeedKind, since: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM feed_events WHERE user_id = ? AND kind = ? AND at > ?")
    .get(userId, kind, since);
}

/** New leader and new entries in the top 10, compared with the previous refresh. */
export function trackRanks(db: Db, season: Season, now: number): void {
  const ranked = db
    .prepare(
      `SELECT g.user_id AS id FROM games g JOIN users u ON u.id = g.user_id
       WHERE g.season_id = ? AND u.pseudo IS NOT NULL AND g.score > 0
       ORDER BY g.score DESC, u.id LIMIT ${TOP_SIZE}`,
    )
    .all(season.id) as { id: number }[];
  const top = ranked.map((r) => r.id);
  const { top: prevJson } = db.prepare("SELECT top FROM seasons WHERE id = ?").get(season.id) as {
    top: string;
  };
  const prev = JSON.parse(prevJson) as number[];
  db.prepare("UPDATE seasons SET top = ? WHERE id = ?").run(JSON.stringify(top), season.id);
  // The first ranking of the season is a starting point, not a change.
  if (prev.length === 0) return;
  const leader = top[0];
  if (leader !== undefined && top.length > 1 && leader !== prev[0]) {
    if (!recent(db, leader, "lead", now - LEAD_COOLDOWN_MS))
      insert(db, season, leader, now, "lead", 1);
  }
  // With 10 players or fewer, everyone is in the top 10: not news.
  const { players } = db
    .prepare("SELECT count(*) AS players FROM games WHERE season_id = ? AND score > 0")
    .get(season.id) as { players: number };
  if (players > TOP_SIZE) {
    top.forEach((id, i) => {
      if (!prev.includes(id) && !recent(db, id, "top10", now - TOP10_COOLDOWN_MS)) {
        insert(db, season, id, now, "top10", i + 1);
      }
    });
  }
}

export interface FeedEvent {
  at: number;
  kind: FeedKind;
  pseudo: string;
  /** Tier index, dev level or rank. */
  value: number;
  /** First of the season to reach this tier or level. */
  first: boolean;
}

/** The current week of the season: its events, the biggest climbers and who joined. */
export function weekFeed(db: Db, season: Season, now: number) {
  const week = weekIndex(Math.max(0, (now - season.startsAt) / 1000));
  const weekMs = BALANCE.weekSeconds * 1000;
  const startsAt = season.startsAt + week * weekMs;
  const events = db
    .prepare(
      `SELECT e.at, e.kind, e.value, u.pseudo,
         e.kind IN ('tier', 'level') AND NOT EXISTS (
           SELECT 1 FROM feed_events f WHERE f.season_id = e.season_id AND f.kind = e.kind
           AND f.value >= e.value AND (f.at < e.at OR (f.at = e.at AND f.id < e.id))
         ) AS first
       FROM feed_events e JOIN users u ON u.id = e.user_id
       WHERE e.season_id = ? AND e.at >= ? AND u.pseudo IS NOT NULL
       ORDER BY e.at DESC, e.id DESC LIMIT ${FEED_SIZE}`,
    )
    .all(season.id, startsAt) as (Omit<FeedEvent, "first"> & { first: number })[];
  const climbers = db
    .prepare(
      `SELECT u.pseudo, g.score - g.week_base AS gain FROM games g JOIN users u ON u.id = g.user_id
       WHERE g.season_id = ? AND g.week = ? AND u.pseudo IS NOT NULL AND g.score > g.week_base
       ORDER BY gain DESC LIMIT ${CLIMBERS}`,
    )
    .all(season.id, week) as { pseudo: string; gain: number }[];
  const { players, joined } = db
    .prepare(
      `SELECT count(*) AS players, coalesce(sum(joined_at >= ?), 0) AS joined
       FROM games WHERE season_id = ?`,
    )
    .get(startsAt, season.id) as { players: number; joined: number };
  return {
    week: {
      index: week,
      startsAt,
      endsAt: Math.min(startsAt + weekMs, season.endsAt),
      modifier: season.weeks[week] ?? null,
    },
    events: events.map((e): FeedEvent => ({ ...e, first: e.first === 1 })),
    climbers,
    players,
    joined,
  };
}
