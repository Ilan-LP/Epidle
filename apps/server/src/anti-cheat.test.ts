import { HOUR } from "@epidle/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MS, testApp } from "./test-utils";

// Anti-cheat suite: what a player with curl and bad intentions would try.
// Run alone with `pnpm anticheat`.

let t: Awaited<ReturnType<typeof testApp>>;
let token: string;
beforeEach(async () => {
  t = await testApp();
  token = t.player("oid-cheater", "Cheater");
  await t.get(token, "/api/state");
});
afterEach(() => t.app.close());

const state = async () => (await t.get(token, "/api/state")).json().state;
const raw = (payload: string, contentType = "application/json") =>
  t.app.inject({
    method: "POST",
    url: "/api/intent",
    headers: { ...t.auth(token), "content-type": contentType },
    payload,
  });

describe("replays", () => {
  const hire = { type: "hire", kind: "junior", requestId: "replay-0001" };
  const send = () =>
    t.app.inject({ method: "POST", url: "/api/intent", headers: t.auth(token), payload: hire });

  it("applies a request id once, even hours later", async () => {
    t.clock.t += HOUR * MS;
    expect((await send()).statusCode).toBe(200);
    const after = await state();
    const replay = await send();
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error).toBe("replay");
    t.clock.t += 5 * HOUR * MS;
    expect((await send()).statusCode).toBe(409);
    expect((await state()).devs).toHaveLength(after.devs.length);
  });

  it("burns the id of a refused intent too", async () => {
    expect((await send()).statusCode).toBe(422); // 20 EUR at start, a junior costs more
    t.clock.t += HOUR * MS;
    expect((await send()).statusCode).toBe(409);
  });

  it("does not share request ids between players", async () => {
    t.clock.t += HOUR * MS;
    const other = t.player("oid-other", "Other");
    await t.get(other, "/api/state");
    t.clock.t += HOUR * MS;
    expect((await send()).statusCode).toBe(200);
    const res = await t.app.inject({
      method: "POST",
      url: "/api/intent",
      headers: t.auth(other),
      payload: hire,
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("forged state and time", () => {
  it("rejects any field the client should not send", async () => {
    t.clock.t += HOUR * MS;
    const before = await state();
    for (const extra of [
      { time: 1e9 },
      { money: 1e12 },
      { state: { money: 1e12 } },
      { now: Date.now() + 1e10 },
    ]) {
      const res = await t.intent(token, { type: "hire", kind: "junior", ...extra });
      expect(res.statusCode, JSON.stringify(extra)).toBe(400);
    }
    const after = await state();
    expect(after.devs).toEqual(before.devs);
    expect(after.money).toBe(before.money);
  });

  it("rejects prototype pollution, wrong content types, huge bodies and garbage", async () => {
    expect(
      (
        await raw(
          '{"type":"hire","kind":"junior","requestId":"proto-0001","__proto__":{"money":1}}',
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await raw("type=hire&kind=junior", "application/x-www-form-urlencoded")).statusCode,
    ).toBe(415);
    expect(
      (
        await raw(
          JSON.stringify({ type: "hire", kind: "x".repeat(10_000), requestId: "big-00001" }),
        )
      ).statusCode,
    ).toBe(413);
    expect((await raw("{not json")).statusCode).toBe(400);
    expect((await raw("[]")).statusCode).toBe(400);
  });
});

describe("negative and absurd values", () => {
  const cases: Record<string, unknown>[] = [
    { type: "hire", kind: "junior", count: -1 },
    { type: "hire", kind: "junior", count: 0 },
    { type: "hire", kind: "junior", count: 1.5 },
    { type: "hire", kind: "junior", count: "10" },
    { type: "hire", kind: "junior", count: 1_000_000 },
    { type: "hire", kind: "intern" },
    { type: "hire", kind: "__proto__" },
    { type: "train", devId: -1 },
    { type: "train", devId: 0 },
    { type: "train", devId: 1, targetLevel: 0 },
    { type: "train", devId: 1, targetLevel: 99 },
    { type: "train", devId: 1, targetLevel: -3 },
    { type: "buyMouli", stage: "loc", count: -5 },
    { type: "buyMouli", stage: "../../etc" },
    { type: "setStrictness", stage: "loc", level: -1 },
    { type: "setStrictness", stage: "loc", level: 4 },
    { type: "setStrictness", stage: "loc", level: null },
    { type: "sellEverything" },
    { kind: "junior" },
  ];

  it.each(cases)("rejects %o", async (body) => {
    const res = await t.intent(token, body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
  });

  it("rejects numbers JSON turns into Infinity", async () => {
    const res = await raw('{"type":"hire","kind":"junior","count":1e999,"requestId":"inf-00001"}');
    expect(res.statusCode).toBe(400);
  });

  it("rejects malformed request ids", async () => {
    for (const requestId of ["short", "a".repeat(65), "'; DROP TABLE games;--", 12345678]) {
      const res = await t.app.inject({
        method: "POST",
        url: "/api/intent",
        headers: t.auth(token),
        payload: { type: "buyRoom", requestId },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it("rejects injection attempts in query strings and paths", async () => {
    expect((await t.get(token, "/api/leaderboard?scope=season'%20OR%201=1--")).statusCode).toBe(
      400,
    );
    expect((await t.get(token, "/api/players/x'%20OR%20'1'='1/build")).statusCode).toBe(400);
  });
});

describe("unaffordable and locked purchases", () => {
  it("refuses them without spending anything", async () => {
    const before = await state();
    for (const body of [
      { type: "hire", kind: "junior" },
      { type: "hire", kind: "senior" },
      { type: "buyRoom" },
      { type: "buyMouli", stage: "products" },
      { type: "upgradeMouli", stage: "loc" },
      { type: "train", devId: 1, targetLevel: 11 },
    ]) {
      const res = await t.intent(token, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
      expect(["insufficient_funds", "locked"]).toContain(res.json().error);
    }
    const after = await state();
    expect(after.money).toBe(before.money);
    expect(after.devs).toEqual(before.devs);
  });

  it("never goes below zero under a burst of parallel purchases", async () => {
    t.clock.t += HOUR * MS; // enough for a few hires, not 25
    const before = await state();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => t.intent(token, { type: "hire", kind: "junior" })),
    );
    const ok = results.filter((r) => r.statusCode === 200).length;
    const after = await state();
    expect(ok).toBeGreaterThan(0);
    expect(ok).toBeLessThan(25);
    expect(after.money).toBeGreaterThanOrEqual(0);
    expect(after.devs).toHaveLength(before.devs.length + ok);
  });

  it("cannot train a dev twice or use more rooms than owned", async () => {
    t.clock.t += 3 * HOUR * MS;
    expect((await t.intent(token, { type: "train", devId: 1 })).statusCode).toBe(200);
    expect((await t.intent(token, { type: "train", devId: 1 })).json().error).toBe("busy");
    expect((await t.intent(token, { type: "train", devId: 2 })).json().error).toBe("no_free_room");
  });
});

describe("request spam", () => {
  it("rate limits intents per player, without blocking other players", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) {
      codes.push(
        (await t.intent(token, { type: "setStrictness", stage: "loc", level: i % 4 })).statusCode,
      );
    }
    expect(codes.filter((c) => c === 200)).toHaveLength(30);
    expect(codes.slice(30).every((c) => c === 429)).toBe(true);
    const limited = await t.intent(token, { type: "buyRoom" });
    expect(limited.json()).toMatchObject({
      error: "rate_limited",
      message: expect.stringContaining("Trop"),
    });

    const other = t.player("oid-other", "Other");
    expect(
      (await t.intent(other, { type: "setStrictness", stage: "loc", level: 0 })).statusCode,
    ).toBe(200);
  });

  it("rate limits every endpoint, logged in or not", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 310; i++) codes.push((await t.get(token, "/api/me")).statusCode);
    // 300 per minute, beforeEach already used one.
    expect(codes.filter((c) => c === 429)).toHaveLength(11);
    const anon = await Promise.all(
      Array.from({ length: 130 }, () => t.app.inject({ method: "POST", url: "/api/auth/device" })),
    );
    expect(anon.some((r) => r.statusCode === 429)).toBe(true);
  });

  it("limits device code polling per login", async () => {
    const { handle } = (await t.app.inject({ method: "POST", url: "/api/auth/device" })).json();
    const codes: number[] = [];
    for (let i = 0; i < 35; i++) {
      const res = await t.app.inject({
        method: "POST",
        url: "/api/auth/device/token",
        payload: { handle },
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes.slice(30).every((c) => c === 429)).toBe(true);
  });

  it("counts invalid and anonymous requests too", async () => {
    const invalid: number[] = [];
    for (let i = 0; i < 32; i++) invalid.push((await t.intent(token, { type: "nope" })).statusCode);
    expect(invalid.slice(30)).toEqual([429, 429]);
    const anon: number[] = [];
    for (let i = 0; i < 302; i++)
      anon.push((await t.app.inject({ method: "GET", url: "/api/state" })).statusCode);
    expect(anon.at(-1)).toBe(429);
  });

  it("does not let a forged token through", async () => {
    for (const header of ["Bearer nope", "Bearer ", `Bearer ${token}x`, token]) {
      const res = await t.app.inject({
        method: "GET",
        url: "/api/state",
        headers: { authorization: header },
      });
      expect(res.statusCode).toBe(401);
    }
  });
});
