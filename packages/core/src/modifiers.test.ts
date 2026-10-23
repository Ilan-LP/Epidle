import { describe, expect, it } from "vitest";
import { advance } from "./advance";
import { BALANCE, DAY, HOUR } from "./config";
import { computeRates, hireCost, trainingSeconds } from "./economy";
import { buyMouli, hire, train } from "./intents";
import {
  advanceSeason,
  applyEffects,
  balanceAt,
  type Modifier,
  modifierError,
  type SeasonWeeks,
  weekIndex,
} from "./modifiers";
import { createInitialState, type GameState } from "./state";

const rush: Modifier = {
  id: "rush",
  name: "Semaine Rush",
  description: "Les devs codent plus vite, avec plus de bugs.",
  effects: { devSpeed: 1.5, bugs: 1.3 },
};

function unwrap(r: { ok: true; state: GameState } | { ok: false; error: string }): GameState {
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function company(): GameState {
  let s: GameState = { ...createInitialState(), money: 1e6, tier: 1, tierUnlockedAt: [0, 0] };
  s = unwrap(hire(s, "junior"));
  s = unwrap(buyMouli(s, "loc"));
  return unwrap(train(s, 1, 6));
}

describe("applyEffects", () => {
  it("multiplies the matching balance numbers and nothing else", () => {
    const cfg = applyEffects({ devSpeed: 2, hireCost: 0.5, value: 3, bugs: 10 });
    expect(cfg.dev.baseLocPerSecond).toBe(BALANCE.dev.baseLocPerSecond * 2);
    expect(cfg.hire.baseCost).toBe(BALANCE.hire.baseCost * 0.5);
    expect(cfg.stages[1]?.valuePerLoc).toBe((BALANCE.stages[1]?.valuePerLoc ?? 0) * 3);
    expect(cfg.initialBugDensity).toBe(1);
    expect(cfg.training).toEqual(BALANCE.training);
    expect(cfg.tiers).toBe(BALANCE.tiers);
    expect(applyEffects({})).toEqual(BALANCE);
  });

  it("feeds every rule through the config", () => {
    const s = createInitialState();
    const cfg = applyEffects({ hireCost: 0.5, devSpeed: 2, trainingTime: 0.5 });
    expect(hireCost(s, "junior", cfg)).toBe(hireCost(s, "junior") / 2);
    expect(computeRates(s, cfg).locPerSecond).toBe(computeRates(s).locPerSecond * 2);
    expect(trainingSeconds(3, cfg)).toBe(trainingSeconds(3) / 2);
  });
});

describe("weeks", () => {
  const weeks: SeasonWeeks = [rush, null];

  it("splits the season in 7-day weeks, the end belonging to the last one", () => {
    expect(weekIndex(0)).toBe(0);
    expect(weekIndex(7 * DAY - 1)).toBe(0);
    expect(weekIndex(7 * DAY)).toBe(1);
    expect(weekIndex(BALANCE.seasonSeconds)).toBe(1);
    expect(balanceAt(weeks, 0).dev.baseLocPerSecond).toBe(1.5);
    expect(balanceAt(weeks, 8 * DAY)).toBe(BALANCE);
    expect(balanceAt(weeks, 0)).toBe(balanceAt(weeks, HOUR));
  });

  it("is plain advance when no week has a modifier", () => {
    const s = company();
    expect(advanceSeason(s, 3 * DAY, [null, null])).toEqual(advance(s, 3 * DAY));
    expect(advanceSeason(s, 3 * DAY, [])).toEqual(advance(s, 3 * DAY));
  });

  it("integrates each week with its own balance", () => {
    const s = { ...company(), time: 7 * DAY - HOUR };
    const after = advanceSeason(s, 2 * HOUR, weeks);
    const expected = advance(advance(s, HOUR, balanceAt(weeks, 0)), HOUR);
    expect(after.time).toBe(7 * DAY + HOUR);
    expect(after.revenue).toBeCloseTo(expected.revenue, 6);
    expect(after.revenue).not.toBeCloseTo(advance(s, 2 * HOUR).revenue, 0);
  });

  it("gives the same result in one step or in many, across the boundary", () => {
    const s = { ...company(), time: 6 * DAY };
    const once = advanceSeason(s, 2 * DAY, weeks);
    let many = s;
    for (let i = 0; i < 48; i++) many = advanceSeason(many, HOUR, weeks);
    expect(many.time).toBeCloseTo(once.time);
    expect(many.money).toBeCloseTo(once.money, 3);
    expect(many.revenue).toBeCloseTo(once.revenue, 3);
    expect(many.devs).toEqual(once.devs);
  });

  it("stops at the season end", () => {
    const end = advanceSeason(company(), 30 * DAY, weeks);
    expect(end.time).toBe(BALANCE.seasonSeconds);
    expect(() => advanceSeason(end, -1, weeks)).toThrow(RangeError);
  });
});

describe("modifierError", () => {
  it("accepts a valid modifier", () => {
    expect(modifierError(rush)).toBeNull();
  });

  it.each([
    [null, "object"],
    [{ ...rush, id: "Rush!" }, "id"],
    [{ ...rush, name: "" }, "name"],
    [{ ...rush, effects: { speed: 2 } }, "unknown effect"],
    [{ ...rush, effects: { devSpeed: 10 } }, "between"],
    [{ ...rush, effects: { devSpeed: "2" } }, "between"],
  ])("refuses %j", (value, message) => {
    expect(modifierError(value)).toContain(message);
  });
});
