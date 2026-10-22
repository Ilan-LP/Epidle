import { describe, expect, it } from "vitest";
import { BALANCE, DAY } from "./config";
import { devLocPerSecond, devSalaryPerSecond, maxLevel, trainingPlan } from "./economy";

// Invariants the balance must keep whatever the tuning.
describe("balance config", () => {
  it("has 11 training levels after Junior, each taking twice as long as the previous one", () => {
    expect(maxLevel()).toBe(11);
    expect(BALANCE.training.durationGrowth).toBe(2);
  });

  it("makes the max level take roughly one season of non-stop training", () => {
    const { seconds } = trainingPlan(0, maxLevel());
    expect(seconds / BALANCE.seasonSeconds).toBeGreaterThan(0.7);
    expect(seconds / BALANCE.seasonSeconds).toBeLessThan(1.1);
    expect(BALANCE.seasonSeconds).toBe(14 * DAY);
  });

  it("pays every working dev more than their salary, even shipping raw buggy code", () => {
    // This is what rules out a negative-money death spiral: production never depends on money,
    // and every dev is profitable on their own.
    const rawValue = BALANCE.rawValuePerLoc * (1 - BALANCE.initialBugDensity);
    for (let level = 0; level <= maxLevel(); level++) {
      expect(devLocPerSecond(level) * rawValue).toBeGreaterThan(devSalaryPerSecond(level));
    }
  });

  it("lists tiers in increasing revenue order, starting at 0", () => {
    expect(BALANCE.tiers[0]?.revenue).toBe(0);
    for (let i = 1; i < BALANCE.tiers.length; i++) {
      expect(BALANCE.tiers[i]?.revenue).toBeGreaterThan(BALANCE.tiers[i - 1]?.revenue ?? 0);
    }
  });

  it("only references existing tiers", () => {
    const tiers = [
      ...BALANCE.stages.map((s) => s.tier),
      ...Object.values(BALANCE.hire.kinds).map((k) => k.tier),
    ];
    for (const tier of tiers) expect(BALANCE.tiers[tier]).toBeDefined();
  });

  it("makes stricter moulis slower", () => {
    for (let i = 1; i < BALANCE.strictness.length; i++) {
      const prev = BALANCE.strictness[i - 1];
      const cur = BALANCE.strictness[i];
      expect(cur?.catchRate).toBeGreaterThan(prev?.catchRate ?? 0);
      expect(cur?.speed).toBeLessThan(prev?.speed ?? 0);
    }
  });
});
