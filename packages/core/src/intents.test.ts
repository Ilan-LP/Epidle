import { describe, expect, it } from "vitest";
import { BALANCE } from "./config";
import { hireCost, mouliCost, mouliUpgradeCost, roomCost, trainingPlan } from "./economy";
import {
  buyMouli,
  buyRoom,
  hire,
  INTENT_ERROR_MESSAGES,
  type IntentResult,
  setStrictness,
  train,
  upgradeMouli,
} from "./intents";
import { createInitialState, type GameState } from "./state";

const rich = (patch: Partial<GameState> = {}): GameState => ({
  ...createInitialState(),
  money: 1e12,
  ...patch,
});

function ok(r: IntentResult): GameState {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.state;
}

const errorOf = (r: IntentResult) => (r.ok ? null : r.error);

describe("hire", () => {
  it("adds a dev at the level of their kind and charges the cost", () => {
    const s = rich({ tier: 4 });
    const after = ok(hire(s, "senior"));
    expect(after.devs).toHaveLength(s.devs.length + 1);
    expect(after.devs.at(-1)).toMatchObject({ kind: "senior", level: 6, training: null });
    expect(after.money).toBe(s.money - hireCost(s, "senior"));
    expect(after.nextDevId).toBe(s.nextDevId + 1);
  });

  it("refuses kinds of a higher tier, unknown kinds and missing money", () => {
    expect(errorOf(hire(rich(), "senior"))).toBe("locked");
    // Clients are untrusted: the kind may be anything.
    expect(errorOf(hire(rich(), "toString" as never))).toBe("invalid_value");
    expect(errorOf(hire(createInitialState(), "junior"))).toBe("insufficient_funds");
  });
});

describe("train", () => {
  it("pays every level upfront and occupies a room", () => {
    const s = rich();
    const after = ok(train(s, 1, 3));
    expect(after.money).toBe(s.money - trainingPlan(0, 3).cost);
    expect(after.devs[0]?.training?.targetLevel).toBe(3);
    expect(errorOf(train(after, 2))).toBe("no_free_room");
    expect(errorOf(train(after, 1))).toBe("busy");
  });

  it("validates the dev and the target level", () => {
    const s = rich();
    expect(errorOf(train(s, 999))).toBe("not_found");
    expect(errorOf(train(s, 1, 0))).toBe("invalid_value");
    expect(errorOf(train(s, 1, 1.5))).toBe("invalid_value");
    expect(errorOf(train(s, 1, 99))).toBe("invalid_value");
    const maxed = rich({
      devs: [{ id: 1, kind: "junior", level: BALANCE.levels.length - 1, training: null }],
    });
    expect(errorOf(train(maxed, 1))).toBe("max_level");
  });
});

describe("rooms and moulis", () => {
  it("buys rooms up to the max", () => {
    const s = rich();
    const after = ok(buyRoom(s));
    expect(after.rooms).toBe(s.rooms + 1);
    expect(after.money).toBe(s.money - roomCost(s));
    expect(errorOf(buyRoom(rich({ rooms: BALANCE.rooms.max })))).toBe("max_rooms");
  });

  it("buys and upgrades unlocked stages only", () => {
    const s = rich();
    const bought = ok(buyMouli(s, "loc"));
    expect(bought.stages[0]?.instances).toBe(1);
    expect(bought.money).toBe(s.money - mouliCost(s, "loc"));
    expect(mouliCost(bought, "loc")).toBeGreaterThan(mouliCost(s, "loc"));
    const upgraded = ok(upgradeMouli(bought, "loc"));
    expect(upgraded.stages[0]?.version).toBe(1);
    expect(upgraded.money).toBe(bought.money - mouliUpgradeCost(bought, "loc"));
    expect(errorOf(buyMouli(s, "products"))).toBe("locked");
    expect(errorOf(upgradeMouli(s, "products"))).toBe("locked");
    expect(errorOf(buyMouli(s, "nope" as never))).toBe("not_found");
  });

  it("sets strictness for free, within bounds", () => {
    const s = rich();
    const after = ok(setStrictness(s, "loc", 3));
    expect(after.stages[0]?.strictness).toBe(3);
    expect(after.money).toBe(s.money);
    expect(errorOf(setStrictness(s, "loc", BALANCE.strictness.length))).toBe("invalid_value");
    expect(errorOf(setStrictness(s, "loc", -1))).toBe("invalid_value");
    expect(errorOf(setStrictness(s, "loc", 0.5))).toBe("invalid_value");
  });
});

describe("all intents", () => {
  it("refuse to run after the season ends", () => {
    const over = rich({ time: BALANCE.seasonSeconds });
    expect(errorOf(hire(over, "junior"))).toBe("season_over");
    expect(errorOf(train(over, 1))).toBe("season_over");
    expect(errorOf(buyRoom(over))).toBe("season_over");
    expect(errorOf(buyMouli(over, "loc"))).toBe("season_over");
    expect(errorOf(upgradeMouli(over, "loc"))).toBe("season_over");
    expect(errorOf(setStrictness(over, "loc", 0))).toBe("season_over");
  });

  it("never mutate their input", () => {
    const s = rich();
    const copy = JSON.parse(JSON.stringify(s));
    hire(s, "junior");
    train(s, 1, 2);
    buyRoom(s);
    buyMouli(s, "loc");
    upgradeMouli(s, "loc");
    setStrictness(s, "loc", 0);
    expect(s).toEqual(copy);
  });

  it("have a French message for every error", () => {
    for (const message of Object.values(INTENT_ERROR_MESSAGES)) expect(message).not.toBe("");
  });
});
