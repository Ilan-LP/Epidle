import { describe, expect, it } from "vitest";
import { advance } from "./advance";
import { BALANCE, DAY, HOUR } from "./config";
import { computeRates, trainingPlan, trainingSeconds } from "./economy";
import { buyMouli, hire, train } from "./intents";
import { createInitialState, type GameState } from "./state";

function unwrap(r: { ok: true; state: GameState } | { ok: false; error: string }): GameState {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

/** A small company with a training in progress, so advance crosses level-ups. */
function busyCompany(): GameState {
  let s = createInitialState();
  s = { ...s, money: 1e6, tier: 1, tierUnlockedAt: [0, 0] };
  s = unwrap(hire(s, "junior"));
  s = unwrap(buyMouli(s, "loc"));
  return unwrap(train(s, 1, 4));
}

describe("advance", () => {
  it("integrates constant rates exactly", () => {
    const s = createInitialState();
    const r = computeRates(s);
    const after = advance(s, 100);
    expect(after.time).toBe(100);
    expect(after.money).toBeCloseTo(s.money + 100 * r.netPerSecond);
    expect(after.revenue).toBeCloseTo(100 * r.revenuePerSecond);
    expect(after.stats.locWritten).toBeCloseTo(100 * r.locPerSecond);
  });

  it("gives the same result in one step or in many", () => {
    const s = busyCompany();
    const once = advance(s, 5 * HOUR);
    let many = s;
    for (let i = 0; i < 300; i++) many = advance(many, 60);
    expect(many.time).toBeCloseTo(once.time);
    expect(many.money).toBeCloseTo(once.money, 6);
    expect(many.revenue).toBeCloseTo(once.revenue, 6);
    expect(many.devs).toEqual(once.devs);
  });

  it("levels up one level at a time until the target, then frees the room", () => {
    const s = busyCompany();
    const first = trainingSeconds(0);
    const mid = advance(s, first + 1);
    expect(mid.devs[0]?.level).toBe(1);
    expect(mid.devs[0]?.training?.targetLevel).toBe(4);
    const done = advance(s, trainingPlan(0, 4).seconds);
    expect(done.devs[0]?.level).toBe(4);
    expect(done.devs[0]?.training).toBeNull();
  });

  it("records the exact time a tier is unlocked", () => {
    const s = createInitialState();
    const threshold = BALANCE.tiers[1]?.revenue ?? 0;
    const expected = threshold / computeRates(s).revenuePerSecond;
    const after = advance(s, 2 * expected);
    expect(after.tier).toBeGreaterThanOrEqual(1);
    expect(after.tierUnlockedAt[1]).toBeCloseTo(expected);
  });

  it("stops at the end of the season", () => {
    const s = advance(createInitialState(), 20 * DAY);
    expect(s.time).toBe(BALANCE.seasonSeconds);
    expect(advance(s, HOUR)).toEqual(s);
  });

  it("does not mutate its input", () => {
    const s = busyCompany();
    const copy = JSON.parse(JSON.stringify(s));
    advance(s, DAY);
    expect(s).toEqual(copy);
  });

  it("rejects negative or non-finite durations", () => {
    const s = createInitialState();
    expect(() => advance(s, -1)).toThrow(RangeError);
    expect(() => advance(s, Number.NaN)).toThrow(RangeError);
    expect(() => advance(s, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
