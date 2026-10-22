import { describe, expect, it } from "vitest";
import { BALANCE, type Balance } from "./config";
import { computeRates, hireCost, trainingPlan } from "./economy";
import { createInitialState, type GameState } from "./state";

// A tiny config with round numbers, so the pipeline math can be checked by hand.
const cfg: Balance = {
  ...BALANCE,
  initialBugDensity: 0.5,
  rawValuePerLoc: 1,
  strictness: [{ name: "half", catchRate: 0.5, speed: 1 }],
  defaultStrictness: 0,
  mouliUpgrade: { throughputFactor: 2, costGrowth: 3 },
  stages: [
    {
      ...(BALANCE.stages[0] as Balance["stages"][number]),
      throughputPerInstance: 1,
      valuePerLoc: 2,
      upkeepPerSecond: 0,
    },
    {
      ...(BALANCE.stages[1] as Balance["stages"][number]),
      throughputPerInstance: 1,
      valuePerLoc: 4,
      upkeepPerSecond: 0,
    },
  ],
  dev: { ...BALANCE.dev, baseSalaryPerSecond: 0 },
};

function withPipeline(juniors: number, instances: number[], versions: number[] = []): GameState {
  const s = createInitialState(cfg);
  s.devs = Array.from({ length: juniors }, (_, i) => ({
    id: i + 1,
    kind: "junior" as const,
    level: 0,
    training: null,
  }));
  s.stages = instances.map((n, i) => ({ instances: n, strictness: 0, version: versions[i] ?? 0 }));
  return s;
}

describe("computeRates", () => {
  it("ships everything raw without moulis", () => {
    const r = computeRates(withPipeline(4, [0, 0]), cfg);
    expect(r.locPerSecond).toBe(4);
    expect(r.revenuePerSecond).toBeCloseTo(4 * 1 * 0.5); // value 1, half the LoC are buggy
    expect(r.quality).toBeCloseTo(0.5);
  });

  it("ships the overflow of a stage at the value of the previous one", () => {
    // 4 LoC/s, stage 1 takes 2: 2 ship raw (1 EUR, 50% bugs), 2 pass stage 1 (bugs -> 25%).
    // Stage 2 takes 1 of those: 1 ships at stage 1 value (2 EUR), 1 at stage 2 value (4 EUR, 12.5%).
    const r = computeRates(withPipeline(4, [2, 1]), cfg);
    expect(r.stages.map((s) => s.processed)).toEqual([2, 1]);
    expect(r.revenuePerSecond).toBeCloseTo(2 * 1 * 0.5 + 1 * 2 * 0.75 + 1 * 4 * 0.875);
    expect(r.bugsPerSecond).toBeCloseTo(2 * 0.5 + 1 * 0.25 + 1 * 0.125);
  });

  it("stops the pipeline at the first stage without instances", () => {
    const r = computeRates(withPipeline(4, [0, 5]), cfg);
    expect(r.stages[1]?.input).toBe(0);
    expect(r.revenuePerSecond).toBeCloseTo(2);
  });

  it("multiplies throughput with mouli versions", () => {
    const r = computeRates(withPipeline(4, [1, 0], [2, 0]), cfg);
    expect(r.stages[0]?.capacity).toBe(4);
  });

  it("does not count devs in training as producing, but still pays them", () => {
    const s = withPipeline(2, [0, 0]);
    const paid = { ...cfg, dev: { ...cfg.dev, baseSalaryPerSecond: 0.1 } };
    const before = computeRates(s, paid);
    const dev = s.devs[0];
    if (dev) dev.training = { targetLevel: 1, levelEndsAt: 100 };
    const after = computeRates(s, paid);
    expect(after.locPerSecond).toBe(before.locPerSecond / 2);
    expect(after.salaryPerSecond).toBe(before.salaryPerSecond);
  });
});

describe("costs", () => {
  it("makes hiring more expensive with headcount", () => {
    const s = createInitialState();
    const bigger = { ...s, devs: [...s.devs, ...s.devs] };
    expect(hireCost(bigger, "junior")).toBeGreaterThan(hireCost(s, "junior"));
    expect(hireCost(s, "senior")).toBeGreaterThan(hireCost(s, "junior"));
  });

  it("sums a multi-level training level by level", () => {
    const one = trainingPlan(0, 1);
    const two = trainingPlan(1, 2);
    const both = trainingPlan(0, 2);
    expect(both.seconds).toBe(one.seconds + two.seconds);
    expect(both.cost).toBe(one.cost + two.cost);
    expect(two.seconds).toBe(2 * one.seconds);
  });
});
