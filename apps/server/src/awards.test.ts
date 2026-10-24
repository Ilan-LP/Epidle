import { BALANCE, createInitialState, type GameState, maxLevel } from "@epidle/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MS, testApp } from "./test-utils";

let t: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.app.close());

const SEASON_MS = BALANCE.seasonSeconds * MS;

/** Gives a player a company with `revenue`, optionally at the last tier or with a Légende dev. */
function company(pseudo: string, revenue: number, extra: Partial<GameState> = {}) {
  const state: GameState = { ...createInitialState(), revenue, ...extra };
  t.db
    .prepare(
      "UPDATE games SET state = ?, score = ? WHERE user_id = (SELECT id FROM users WHERE pseudo = ?)",
    )
    .run(JSON.stringify(state), revenue, pseudo);
}

describe("season awards", () => {
  it("are given at the season close and kept in the next seasons", async () => {
    const names = ["Alice", "Bobby", "Carol"];
    const tokens = names.map((p, i) => t.player(`oid-${i}`, p));
    for (const token of tokens) await t.get(token, "/api/state");
    const tiers = BALANCE.tiers.map(() => 0);
    company("Alice", 1e12, { tier: BALANCE.tiers.length - 1, tierUnlockedAt: tiers });
    company("Bobby", 5e11, {
      devs: [{ id: 1, kind: "junior", level: maxLevel(), training: null }],
    });
    company("Carol", 1e9);

    t.clock.t += SEASON_MS + 1000;
    t.refresh();

    // Season 2: the leaderboard is fresh, the titles stay.
    for (const token of tokens) await t.get(token, "/api/state");
    t.refresh();
    const board = (await t.get(tokens[2] as string, "/api/leaderboard")).json();
    const title = (pseudo: string) =>
      board.entries.find((e: { pseudo: string }) => e.pseudo === pseudo)?.title;
    expect(title("Alice")).toEqual({ seasonId: 1, kind: "rank", value: 1 });
    // A Légende dev weighs more than a second place.
    expect(title("Bobby")).toEqual({ seasonId: 1, kind: "legende", value: 0 });
    expect(title("Carol")).toEqual({ seasonId: 1, kind: "rank", value: 3 });

    const build = (await t.get(tokens[2] as string, "/api/players/alice/build")).json();
    expect(build.badges).toEqual([
      { seasonId: 1, kind: "licorne", value: 0 },
      { seasonId: 1, kind: "rank", value: 1 },
    ]);
  });

  it("are given once, even if the close runs again", async () => {
    const a = t.player("oid-a", "Alice");
    await t.get(a, "/api/state");
    company("Alice", 1e6);
    t.clock.t += SEASON_MS + 1000;
    t.refresh();
    t.refresh();
    expect(t.db.prepare("SELECT count(*) AS n FROM awards").get()).toEqual({ n: 1 });
  });

  it("never rank an account without a pseudo", async () => {
    const a = t.player("oid-a", "Alice");
    await t.get(a, "/api/state");
    company("Alice", 1e6);
    t.db.prepare("UPDATE users SET pseudo = NULL, pseudo_key = NULL").run();
    t.clock.t += SEASON_MS + 1000;
    t.refresh();
    expect(t.db.prepare("SELECT count(*) AS n FROM awards").get()).toEqual({ n: 0 });
  });
});
