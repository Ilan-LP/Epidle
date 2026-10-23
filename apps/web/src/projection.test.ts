import { advance, computeRates, createInitialState } from "@epidle/core";
import { describe, expect, it } from "vitest";
import type { GameView } from "./api";
import { affordableIn, newer, precheck, project, type Snapshot } from "./projection";

const view = (serverTime: number): GameView => {
  const state = createInitialState();
  return {
    serverTime,
    season: { id: 1, startsAt: 0, endsAt: 100_000 },
    state,
    rates: computeRates(state),
  };
};

describe("project", () => {
  it("advances the last view by the local elapsed time", () => {
    const snap: Snapshot = { view: view(10_000), receivedAt: 500 };
    const p = project(snap, 500 + 30_000);
    expect(p.state).toEqual(advance(snap.view.state, 30));
    expect(p.serverNow).toBe(40_000);
    expect(p.seasonLeft).toBe(60);
  });

  it("never goes back in time", () => {
    const snap: Snapshot = { view: view(10_000), receivedAt: 500 };
    expect(project(snap, 0).state.time).toBe(snap.view.state.time);
  });

  it("clamps the season countdown at 0", () => {
    expect(project({ view: view(99_000), receivedAt: 0 }, 5_000).seasonLeft).toBe(0);
  });
});

describe("affordableIn", () => {
  it("handles the three cases", () => {
    expect(affordableIn(10, 20, 1)).toBe(0);
    expect(affordableIn(30, 20, 2)).toBe(5);
    expect(affordableIn(30, 20, 0)).toBeNull();
  });
});

describe("newer", () => {
  it("keeps the most recent server time", () => {
    const a = { view: view(2_000), receivedAt: 0 };
    const b = { view: view(1_000), receivedAt: 1 };
    expect(newer(a, b)).toBe(a);
    expect(newer(b, a)).toBe(a);
    expect(newer(null, b)).toBe(b);
  });
});

describe("precheck", () => {
  it("explains refusals with the core rules", () => {
    const s = { ...createInitialState(), money: 1000 };
    expect(precheck(s, { type: "hire", kind: "junior" })).toBeNull();
    expect(precheck({ ...s, money: 0 }, { type: "hire", kind: "junior" })).toBe(
      "insufficient_funds",
    );
    expect(precheck(s, { type: "hire", kind: "senior" })).toBe("locked");
    expect(precheck(s, { type: "train", devId: 999 })).toBe("not_found");
    expect(precheck({ ...s, rooms: 0 }, { type: "train", devId: 1 })).toBe("no_free_room");
  });
});
