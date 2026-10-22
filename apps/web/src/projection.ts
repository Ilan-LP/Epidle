import {
  advance,
  buyMouli,
  buyRoom,
  computeRates,
  type GameState,
  hire,
  type IntentError,
  type IntentResult,
  type Rates,
  setStrictness,
  train,
  upgradeMouli,
} from "@epidle/core";
import type { GameView, Intent } from "./api";

// The server is the source of truth. Between two responses the client only extrapolates the
// last one with the same pure core, to animate counters. Nothing computed here is ever sent.

export interface Snapshot {
  view: GameView;
  /** Local monotonic clock (performance.now) when the view was received. */
  receivedAt: number;
}

export interface Projection {
  state: GameState;
  rates: Rates;
  /** Estimated server clock (ms). */
  serverNow: number;
  /** Seconds until the end of the season, 0 once it is over. */
  seasonLeft: number;
}

export function project(snap: Snapshot, clock: number): Projection {
  // A monotonic clock, not Date.now: immune to the local clock being wrong or changed.
  const elapsed = Math.max(0, (clock - snap.receivedAt) / 1000);
  const state = advance(snap.view.state, elapsed);
  const serverNow = snap.view.serverTime + elapsed * 1000;
  return {
    state,
    rates: computeRates(state),
    serverNow,
    seasonLeft: Math.max(0, (snap.view.season.endsAt - serverNow) / 1000),
  };
}

/** Seconds until `cost` is affordable at the current net rate: 0 if it already is, null if never. */
export function affordableIn(cost: number, money: number, netPerSecond: number): number | null {
  if (money >= cost) return 0;
  if (netPerSecond <= 0) return null;
  return (cost - money) / netPerSecond;
}

/** Keeps the newest view: responses can arrive out of order (a poll racing an intent). */
export function newer(prev: Snapshot | null, next: Snapshot): Snapshot {
  return prev && prev.view.serverTime > next.view.serverTime ? prev : next;
}

/**
 * Runs the intent on the projected state with the core rules, to explain a refusal without a
 * request. Only ever used to skip a request that would fail: the server decides what succeeds.
 */
export function precheck(state: GameState, intent: Intent): IntentError | null {
  const r = ((): IntentResult => {
    switch (intent.type) {
      case "hire":
        return hire(state, intent.kind);
      case "train":
        return train(state, intent.devId, intent.targetLevel);
      case "buyRoom":
        return buyRoom(state);
      case "buyMouli":
        return buyMouli(state, intent.stage);
      case "upgradeMouli":
        return upgradeMouli(state, intent.stage);
      case "setStrictness":
        return setStrictness(state, intent.stage, intent.level);
    }
  })();
  return r.ok ? null : r.error;
}
