import { computeRates, createInitialState, DAY, type GameState, HOUR } from "@epidle/core";
import { describe, expect, it } from "vitest";
import { recordProgress } from "./feed";
import { getSeason } from "./seasons";
import { MS, T0, testApp } from "./test-utils";

type T = Awaited<ReturnType<typeof testApp>>;

/** Replaces a player's company with a new one at `revenue`, at the current season time. */
function score(t: T, pseudo: string, revenue: number) {
  const state: GameState = { ...createInitialState(), time: (t.clock.t - T0) / 1000, revenue };
  t.db
    .prepare(
      "UPDATE games SET state = ?, score = ? WHERE user_id = (SELECT id FROM users WHERE pseudo = ?)",
    )
    .run(JSON.stringify(state), revenue, pseudo);
}

async function players(t: T, n: number) {
  const tokens: string[] = [];
  for (let i = 0; i < n; i++) {
    const token = t.player(`oid-${i}`, `P${i}`);
    await t.get(token, "/api/state");
    tokens.push(token);
  }
  return tokens;
}

/** Past the 30 s cache of the scores, then reads the feed. */
async function feed(t: T, token: string) {
  t.clock.t += 31 * MS;
  return (await t.get(token, "/api/feed")).json();
}

describe("recordProgress", () => {
  it("records tiers from PME up at their exact unlock time, and new max dev levels from Lead", async () => {
    const t = await testApp();
    await players(t, 1);
    const season = getSeason(t.db, 1);
    if (!season) throw new Error("no season");
    const user = 1;
    const before: GameState = { ...createInitialState(), tier: 1, tierUnlockedAt: [0, 60] };
    const after: GameState = {
      ...before,
      time: 2 * DAY,
      tier: 3,
      tierUnlockedAt: [0, 60, DAY, 1.5 * DAY],
      devs: [{ id: 1, kind: "junior", level: 8, training: null }],
    };
    recordProgress(t.db, season, user, before, after);
    recordProgress(t.db, season, user, after, after);
    expect(t.db.prepare("SELECT kind, value, at FROM feed_events ORDER BY id").all()).toEqual([
      { kind: "tier", value: 2, at: T0 + DAY * MS },
      { kind: "tier", value: 3, at: T0 + 1.5 * DAY * MS },
      { kind: "level", value: 8, at: T0 + 2 * DAY * MS },
    ]);
  });
});

describe("GET /api/feed", () => {
  it("announces the week and its modifier", async () => {
    const t = await testApp({
      rotation: [
        { id: "rush", name: "Semaine Rush", description: "Vite.", effects: { devSpeed: 2 } },
      ],
    });
    const [token] = await players(t, 1);
    const body = await feed(t, token as string);
    expect(body.week).toEqual({
      index: 0,
      startsAt: T0,
      endsAt: T0 + 7 * DAY * MS,
      modifier: expect.objectContaining({ name: "Semaine Rush" }),
    });
    expect(body).toMatchObject({ players: 1, joined: 1, events: [] });
  });

  it("reports a new leader and new entries in the top 10, once", async () => {
    const t = await testApp();
    const tokens = await players(t, 12);
    for (let i = 0; i < tokens.length; i++) score(t, `P${i}`, 1000 * (i + 1));
    const me = tokens[0] as string;
    // The first ranking is the starting point: nothing to report.
    expect((await feed(t, me)).events).toEqual([]);

    score(t, "P0", 1e6);
    const body = await feed(t, me);
    expect(
      body.events.map((e: { kind: string; pseudo: string; value: number }) => [
        e.kind,
        e.pseudo,
        e.value,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["lead", "P0", 1],
        ["top10", "P0", 1],
      ]),
    );
    expect(body.events).toHaveLength(2);
    // Still leading on the next refresh: no new event.
    expect((await feed(t, me)).events).toHaveLength(2);
  });

  it("ranks the climbers of the week from their exact score at the week start", async () => {
    const t = await testApp();
    const [a, b] = await players(t, 2);
    score(t, "P0", 5000);
    score(t, "P1", 100);
    // Last save just before the boundary, next visit well after it.
    t.clock.t = T0 + 7 * DAY * MS - HOUR * MS;
    await t.get(a as string, "/api/state");
    await t.get(b as string, "/api/state");
    t.clock.t = T0 + 8 * DAY * MS;
    const body = await feed(t, a as string);
    expect(body.week.index).toBe(1);
    expect(body.joined).toBe(0);
    const gains = Object.fromEntries(
      body.climbers.map((c: { pseudo: string; gain: number }) => [c.pseudo, c.gain]),
    );
    // Same company apart from the revenue: both earned one day (+31 s, see feed) at the starting rate.
    const day = computeRates(createInitialState()).revenuePerSecond * (DAY + 31);
    expect(gains.P0).toBeCloseTo(day, 3);
    expect(gains.P1).toBeCloseTo(day, 3);
  });
});
