import { BALANCE, DAY, HOUR, hireCost } from "@epidle/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MS, testApp } from "./test-utils";

let t: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.app.close());

describe("pseudo", () => {
  it("is required to play, 3-16 chars, unique ignoring case", async () => {
    const a = await t.login("oid-a");
    expect((await t.get(a, "/api/state")).json().error).toBe("pseudo_required");
    const put = (token: string, pseudo: string) =>
      t.app.inject({
        method: "PUT",
        url: "/api/me/pseudo",
        headers: t.auth(token),
        payload: { pseudo },
      });
    for (const bad of ["ab", "a".repeat(17), "Jean Dupont", "<script>", "é_t_é"]) {
      expect((await put(a, bad)).statusCode).toBe(400);
    }
    expect((await put(a, "Minilan")).json()).toEqual({ pseudo: "Minilan" });
    const b = await t.login("oid-b");
    expect((await put(b, "minilan")).json().error).toBe("pseudo_taken");
    // Renaming yourself to a different case of your own pseudo is fine.
    expect((await put(a, "MINILAN")).statusCode).toBe(200);
  });
});

describe("state", () => {
  it("creates the company on first visit and advances it with server time", async () => {
    const token = await t.login("oid-a", "Alice");
    const first = (await t.get(token, "/api/state")).json();
    expect(first.state.time).toBe(0);
    expect(first.season).toMatchObject({
      id: 1,
      startsAt: t.clock.t,
      endsAt: t.clock.t + BALANCE.seasonSeconds * 1000,
    });
    expect(first.rates.revenuePerSecond).toBeGreaterThan(0);
    t.clock.t += HOUR * MS;
    const later = (await t.get(token, "/api/state")).json();
    expect(later.state.time).toBe(HOUR);
    expect(later.state.revenue).toBeCloseTo(HOUR * first.rates.revenuePerSecond, 6);
  });
});

describe("intents", () => {
  it("applies an intent at server time and returns the new state", async () => {
    const token = await t.login("oid-a", "Alice");
    await t.get(token, "/api/state"); // the company starts on the first visit
    t.clock.t += 10 * 60_000;
    const before = (await t.get(token, "/api/state")).json().state;
    const res = await t.intent(token, { type: "hire", kind: "junior" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.applied).toBe(1);
    expect(body.state.devs).toHaveLength(before.devs.length + 1);
    expect(body.state.money).toBeCloseTo(before.money - hireCost(before, "junior"));
  });

  it("applies a count until money runs out", async () => {
    const token = await t.login("oid-a", "Alice");
    await t.get(token, "/api/state");
    t.clock.t += 2 * HOUR * MS;
    const body = (await t.intent(token, { type: "hire", kind: "junior", count: 100 })).json();
    expect(body.applied).toBeGreaterThan(0);
    expect(body.applied).toBeLessThan(100);
    expect(body.error).toBe("insufficient_funds");
    expect(body.message).toBe("Pas assez d'argent.");
    expect(body.state.money).toBeGreaterThanOrEqual(0);
  });

  it("refuses with the core error and a French message", async () => {
    const token = await t.login("oid-a", "Alice");
    const res = await t.intent(token, { type: "hire", kind: "senior" });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      error: "locked",
      message: "Pas encore débloqué.",
      applied: 0,
    });
    const train = await t.intent(token, { type: "train", devId: 99 });
    expect(train.json().error).toBe("not_found");
  });

  it("supports every intent type", async () => {
    const token = await t.login("oid-a", "Alice");
    await t.get(token, "/api/state");
    t.clock.t += DAY * MS;
    const ok = async (body: Record<string, unknown>) => {
      const res = await t.intent(token, body);
      expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
      return res.json().state;
    };
    await ok({ type: "buyMouli", stage: "loc", count: 2 });
    await ok({ type: "upgradeMouli", stage: "loc" });
    await ok({ type: "setStrictness", stage: "loc", level: 3 });
    await ok({ type: "buyRoom" });
    const s = await ok({ type: "train", devId: 1, targetLevel: 2 });
    expect(s.stages[0]).toEqual({ instances: 2, version: 1, strictness: 3 });
    expect(s.rooms).toBe(2);
    expect(s.devs[0].training.targetLevel).toBe(2);
  });
});

describe("leaderboard", () => {
  async function players(n: number) {
    const tokens: string[] = [];
    for (let i = 0; i < n; i++) tokens.push(t.player(`oid-${i}`, `player${i}`));
    return tokens;
  }

  it("ranks live scores, caps at 50 and gives my rank", async () => {
    const tokens = await players(55);
    // Everyone starts now; the first 10 also hire, so they earn more.
    for (const token of tokens) await t.get(token, "/api/state");
    t.clock.t += 30 * 60_000;
    for (const token of tokens.slice(0, 10))
      await t.intent(token, { type: "hire", kind: "junior" });
    t.clock.t += HOUR * MS;
    const last = tokens[54] as string;
    const board = (await t.get(last, "/api/leaderboard")).json();
    expect(board.scope).toBe("season");
    expect(board.entries).toHaveLength(50);
    expect(board.entries[0].rank).toBe(1);
    expect(board.entries[0].score).toBeGreaterThan(board.entries[49].score);
    const scores = board.entries.map((e: { score: number }) => e.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    // The 45 who did nothing are tied right after the 10 who hired.
    expect(board.me).toEqual({ rank: 11, score: board.entries[10].score });
  });

  it("all-time sums every season", async () => {
    const [a] = await players(1);
    await t.get(a as string, "/api/state");
    t.clock.t += (BALANCE.seasonSeconds + HOUR) * MS;
    await t.get(a as string, "/api/state");
    const season = (await t.get(a as string, "/api/leaderboard?scope=season")).json();
    const all = (await t.get(a as string, "/api/leaderboard?scope=alltime")).json();
    expect(season.season.id).toBe(2);
    expect(all.me.score).toBeGreaterThan(season.me.score);
    expect((await t.get(a as string, "/api/leaderboard?scope=forever")).statusCode).toBe(400);
  });
});

describe("public build", () => {
  it("shows team and pipeline but not money", async () => {
    const alice = await t.login("oid-a", "Alice");
    const bob = await t.login("oid-b", "Bob");
    await t.get(alice, "/api/state");
    t.clock.t += DAY * MS;
    await t.intent(alice, { type: "hire", kind: "junior", count: 3 });
    await t.intent(alice, { type: "buyMouli", stage: "loc" });
    await t.intent(alice, { type: "setStrictness", stage: "loc", level: 2 });
    await t.intent(alice, { type: "train", devId: 1, targetLevel: 1 });
    const build = (await t.get(bob, "/api/players/alice/build")).json();
    expect(build.pseudo).toBe("Alice");
    expect(build.headcount).toBe(5);
    expect(build.team).toEqual([{ kind: "junior", level: 0, count: 5, training: 1 }]);
    expect(build.stages[0]).toEqual({ id: "loc", instances: 1, version: 0, strictness: 2 });
    expect(build).not.toHaveProperty("money");
    expect(JSON.stringify(build)).not.toContain("oid-a");
    expect((await t.get(bob, "/api/players/nobody/build")).statusCode).toBe(404);
  });
});
