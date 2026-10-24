import { describe, expect, it } from "vitest";
import { advance } from "./advance";
import { DAY } from "./config";
import { train } from "./intents";
import { createInitialState, isGameState } from "./state";

describe("isGameState", () => {
  it("accepts real states, including after JSON round trips and trainings", () => {
    const s = createInitialState();
    expect(isGameState(s)).toBe(true);
    const trained = train({ ...s, money: 1e6 }, 1, 3);
    if (!trained.ok) throw new Error(trained.error);
    expect(isGameState(JSON.parse(JSON.stringify(trained.state)))).toBe(true);
    expect(isGameState(JSON.parse(JSON.stringify(advance(trained.state, DAY))))).toBe(true);
  });

  it("rejects broken or forged shapes", () => {
    const s = createInitialState();
    for (const bad of [
      null,
      "state",
      {},
      { ...s, money: null },
      { ...s, time: "0" },
      { ...s, devs: null },
      { ...s, devs: [{ id: 1, kind: "junior", level: 99, training: null }] },
      { ...s, devs: [{ id: 1, kind: "__proto__", level: 0, training: null }] },
      { ...s, devs: [{ id: 1, kind: "junior", level: 0, training: { targetLevel: 2 } }] },
      { ...s, stages: s.stages.slice(1) },
      { ...s, stages: s.stages.map((st) => ({ ...st, strictness: 9 })) },
      { ...s, tier: 42 },
      { ...s, stats: undefined },
    ]) {
      expect(isGameState(bad), JSON.stringify(bad)?.slice(0, 80)).toBe(false);
    }
  });
});
