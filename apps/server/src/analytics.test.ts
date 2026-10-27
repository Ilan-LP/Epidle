import { createInitialState, DAY, HOUR } from "@epidle/core";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { runAdmin } from "./admin";
import {
  addDays,
  analyticsReport,
  type backfillAnalytics,
  createActivityTracker,
  parisDay,
} from "./analytics";
import { MIGRATIONS, migrate } from "./migrations";
import { MS, T0, testApp } from "./test-utils";

let t: Awaited<ReturnType<typeof testApp>>;
afterEach(() => t?.app.close());

const count = (table: string) =>
  (t.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("days", () => {
  it("are calendar days in Lyon, summer and winter time", () => {
    expect(parisDay(Date.UTC(2026, 9, 1, 21, 59))).toBe("2026-10-01");
    expect(parisDay(Date.UTC(2026, 9, 1, 22, 0))).toBe("2026-10-02");
    expect(parisDay(Date.UTC(2026, 10, 1, 22, 59))).toBe("2026-11-01");
    expect(parisDay(Date.UTC(2026, 10, 1, 23, 0))).toBe("2026-11-02");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("activity", () => {
  it("records first and last seen, active days and the client, once a minute", async () => {
    t = await testApp();
    const token = t.player("oid-a", "Alice");
    const get = () =>
      t.app.inject({
        method: "GET",
        url: "/api/state",
        headers: { ...t.auth(token), "x-epidle-client": "cli/0.2.0" },
      });
    await get();
    t.clock.t += 15 * MS;
    await get();
    const stats = () =>
      t.db.prepare("SELECT first_seen, last_seen, client FROM player_stats").get();
    // The second poll was throttled.
    expect(stats()).toEqual({ first_seen: T0, last_seen: T0, client: "cli/0.2.0" });
    t.clock.t += DAY * MS;
    await t.get(token, "/api/state");
    expect(stats()).toEqual({ first_seen: T0, last_seen: t.clock.t, client: "legacy" });
    // Unchecked routes still know the client.
    t.clock.t += 2 * 60_000;
    await t.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { ...t.auth(token), "x-epidle-client": "web/0.1.0" },
    });
    expect(stats()).toMatchObject({ client: "web/0.1.0" });
    expect(t.db.prepare("SELECT day FROM player_days ORDER BY day").all()).toEqual([
      { day: "2026-10-01" },
      { day: "2026-10-02" },
    ]);
  });

  it("ignores refused requests and anonymous ones", async () => {
    t = await testApp();
    await t.app.inject("/api/state");
    const token = t.player("oid-a", "Alice");
    await t.intent(token, { type: "nope" });
    expect(count("player_stats")).toBe(0);
  });

  it("is deleted with the player", async () => {
    t = await testApp();
    await t.get(t.player("oid-a", "Alice"), "/api/state");
    expect(count("player_days")).toBe(1);
    expect(count("milestones")).toBe(1);
    t.db.prepare("DELETE FROM users").run();
    expect(count("player_stats") + count("player_days") + count("milestones")).toBe(0);
  });

  it("throttles per player and writes again on a new day", async () => {
    t = await testApp();
    const id = t.db.prepare("INSERT INTO users (ms_oid, created_at) VALUES ('x', 0)").run()
      .lastInsertRowid as number;
    const track = createActivityTracker(t.db);
    const night = Date.UTC(2026, 9, 1, 21, 59, 30);
    expect(track(id, null, night)).toBe(true);
    expect(track(id, null, night + 20_000)).toBe(false);
    // 22:00 UTC is midnight in Lyon: a new day, written at once.
    expect(track(id, null, night + 40_000)).toBe(true);
    expect(track(id, null, night + 101_000)).toBe(true);
  });
});

describe("milestones", () => {
  it("log the first time each tier is reached, with its unlock time", async () => {
    t = await testApp();
    const token = t.player("oid-a", "Alice");
    await t.get(token, "/api/state");
    expect(t.db.prepare("SELECT tier, at FROM milestones").all()).toEqual([{ tier: 0, at: T0 }]);
    // Garage to Startup takes a few minutes of the starting juniors.
    t.clock.t += HOUR * MS;
    await t.get(token, "/api/state");
    const rows = t.db.prepare("SELECT tier, at FROM milestones ORDER BY tier").all() as {
      tier: number;
      at: number;
    }[];
    expect(rows.map((r) => r.tier)).toEqual([0, 1]);
    expect(rows[1]?.at).toBeGreaterThan(T0);
    expect(rows[1]?.at).toBeLessThan(t.clock.t);
    // Saving again adds nothing.
    t.refresh();
    expect(count("milestones")).toBe(2);
  });
});

describe("report", () => {
  it("counts active players, D+1 / D+3 retention and the funnel", async () => {
    t = await testApp();
    const track = createActivityTracker(t.db);
    const user = (oid: string) =>
      t.db.prepare("INSERT INTO users (ms_oid, created_at) VALUES (?, 0)").run(oid)
        .lastInsertRowid as number;
    const at = (day: number) => T0 + day * DAY * MS;
    // a: days 0, 1, 3. b: day 0 only. c: days 0, 3. d: starts day 4 (today).
    const [a, b, c, d] = ["a", "b", "c", "d"].map(user) as number[];
    for (const [u, days] of [
      [a, [0, 1, 3]],
      [b, [0]],
      [c, [0, 3]],
      [d, [4]],
    ] as [number, number[]][]) {
      for (const day of days) track(u, null, at(day));
    }
    const milestone = t.db.prepare(
      "INSERT INTO milestones (user_id, season_id, tier, at) VALUES (?, 1, ?, 0)",
    );
    for (const [u, tier] of [
      [a, 0],
      [a, 1],
      [b, 0],
      [c, 0],
    ])
      milestone.run(u, tier);

    const r = analyticsReport(t.db, at(4), 7);
    expect(r.today).toBe("2026-10-05");
    expect(r.daily.slice(-5)).toEqual([
      { day: "2026-10-01", active: 3, new: 3 },
      { day: "2026-10-02", active: 1, new: 0 },
      { day: "2026-10-03", active: 0, new: 0 },
      { day: "2026-10-04", active: 2, new: 0 },
      { day: "2026-10-05", active: 1, new: 1 },
    ]);
    expect(r.cohorts).toEqual([
      { day: "2026-10-01", players: 3, d1: 1, d3: 2 },
      // Today is not over: no retention yet.
      { day: "2026-10-05", players: 1, d1: null, d3: null },
    ]);
    expect(r.retention).toEqual({
      d1: { retained: 1, eligible: 3 },
      d3: { retained: 2, eligible: 3 },
    });
    expect(r.funnel?.tiers.slice(0, 3)).toEqual([
      { tier: 0, name: "Garage", unlocks: "Mouli LoC", players: 3 },
      { tier: 1, name: "Startup", unlocks: "Mouli fichiers", players: 1 },
      { tier: 2, name: "PME", unlocks: null, players: 0 },
    ]);
    // Seen in the last 7 days, d included.
    expect(r.clients).toEqual([{ client: "legacy", players: 4 }]);
  });

  it("prints counts only: no pseudo, no Microsoft id", async () => {
    t = await testApp();
    const token = t.player("oid-secret", "Alice");
    await t.get(token, "/api/state");
    const lines: string[] = [];
    const code = await runAdmin(["analytics", "--days", "3"], {
      db: t.db,
      now: t.clock.t,
      rotation: [],
      backup: null,
      out: (l) => lines.push(l),
    });
    const text = lines.join("\n");
    expect(code).toBe(0);
    expect(text).toContain("Active players per day");
    expect(text).toMatch(/2026-10-01\s+1\s+1/);
    expect(text).toMatch(/0\s+Garage\s+Mouli LoC\s+1\s+100%/);
    expect(text).not.toMatch(/Alice|oid-secret/);
    const bad = await runAdmin(["analytics", "--days", "0"], {
      db: t.db,
      now: t.clock.t,
      rotation: [],
      backup: null,
      out: () => undefined,
    });
    expect(bad).toBe(2);
  });
});

describe("migration 5", () => {
  it("backfills a live database from what it knew, and is idempotent", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    // A database as deployed before analytics: migrations 1 to 4 only.
    for (const step of MIGRATIONS.slice(0, 4)) db.exec(step as string);
    db.pragma("user_version = 4");
    db.prepare("INSERT INTO users (id, ms_oid, created_at) VALUES (1, 'a', ?)").run(T0);
    db.prepare("INSERT INTO seasons (id, starts_at, ends_at) VALUES (1, ?, ?)").run(T0, T0 + 1e9);
    const state = { ...createInitialState(), tier: 1, tierUnlockedAt: [0, 600], time: 3600 };
    db.prepare(
      "INSERT INTO games (user_id, season_id, state, score, joined_at) VALUES (1, 1, ?, 0, ?)",
    ).run(JSON.stringify(state), T0);
    db.prepare("INSERT INTO intent_requests VALUES (1, 'r', ?)").run(T0 + 2 * DAY * MS);

    migrate(db);
    const snapshot = () => ({
      stats: db.prepare("SELECT * FROM player_stats").all(),
      days: db.prepare("SELECT day FROM player_days ORDER BY day").all(),
      milestones: db.prepare("SELECT tier, at FROM milestones ORDER BY tier").all(),
    });
    const after = snapshot();
    expect(after).toEqual({
      stats: [{ user_id: 1, first_seen: T0, last_seen: T0 + 2 * DAY * MS, client: null }],
      days: [{ day: "2026-10-01" }, { day: "2026-10-03" }],
      milestones: [
        { tier: 0, at: T0 },
        { tier: 1, at: T0 + 600 * MS },
      ],
    });
    // Running the step again (schema and data) changes nothing and does not fail.
    const step = MIGRATIONS[4] as { sql: string; data: typeof backfillAnalytics };
    db.exec(step.sql);
    step.data(db);
    expect(snapshot()).toEqual(after);
    // Nothing that existed was touched.
    expect(db.prepare("SELECT count(*) AS n FROM games").get()).toEqual({ n: 1 });
    db.close();
  });
});
