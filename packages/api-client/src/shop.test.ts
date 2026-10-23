import { BALANCE, createInitialState, hireCost, roomCost } from "@epidle/core";
import { describe, expect, it } from "vitest";
import { hireItem, maxAffordable, mouliItem, quote, roomItem } from "./shop";

describe("quote", () => {
  it("sums the growing prices, whatever the money", () => {
    const s = { ...createInitialState(), money: 0 };
    const q = quote(s, hireItem("junior"), 3);
    const expected = [0, 1, 2].reduce(
      (sum, i) => sum + hireCost({ ...s, devs: [...s.devs, ...s.devs.slice(0, i)] }, "junior"),
      0,
    );
    expect(q.count).toBe(3);
    expect(q.error).toBeNull();
    expect(q.cost).toBeCloseTo(expected, 9);
  });

  it("stops on a locked item", () => {
    const q = quote(createInitialState(), hireItem("senior"), 5);
    expect(q).toEqual({ count: 0, cost: 0, error: "locked" });
  });

  it("stops at the max number of rooms", () => {
    const s = { ...createInitialState(), rooms: BALANCE.rooms.max - 1 };
    const q = quote(s, roomItem, 3);
    expect(q.count).toBe(1);
    expect(q.cost).toBe(roomCost(s));
    expect(q.error).toBe("max_rooms");
  });
});

describe("maxAffordable", () => {
  it("counts what the money pays for", () => {
    const s = { ...createInitialState(), money: 50 * 2 ** 1.2 + 50 + 1 };
    expect(maxAffordable(s, mouliItem("loc"), 100)).toBe(2);
    expect(maxAffordable({ ...s, money: 0 }, mouliItem("loc"), 100)).toBe(0);
  });
});
