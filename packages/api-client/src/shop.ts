import {
  BALANCE,
  buyMouli,
  buyRoom,
  cloneState,
  type GameState,
  type HireKind,
  hire,
  hireCost,
  type IntentResult,
  mouliCost,
  mouliUpgradeCost,
  roomCost,
  type StageId,
  upgradeMouli,
} from "@epidle/core";
import type { Intent } from "./api";

// Bulk prices are computed by running the core intents, so the shop shows exactly what the
// server will charge for "x10" (each purchase makes the next one more expensive).

export interface ShopItem {
  key: string;
  label: string;
  /** Cost of the next purchase. */
  price: (s: GameState) => number;
  apply: (s: GameState) => IntentResult;
  intent: (count: number) => Intent;
}

export const hireItem = (kind: HireKind): ShopItem => ({
  key: `hire:${kind}`,
  label: BALANCE.hire.kinds[kind].name,
  price: (s) => hireCost(s, kind),
  apply: (s) => hire(s, kind),
  intent: (count) => ({ type: "hire", kind, count }),
});

export const roomItem: ShopItem = {
  key: "room",
  label: "Salle de formation",
  price: roomCost,
  apply: buyRoom,
  intent: (count) => ({ type: "buyRoom", count }),
};

export const mouliItem = (stage: StageId): ShopItem => ({
  key: `mouli:${stage}`,
  label: "+1 instance",
  price: (s) => mouliCost(s, stage),
  apply: (s) => buyMouli(s, stage),
  intent: (count) => ({ type: "buyMouli", stage, count }),
});

export const upgradeItem = (stage: StageId): ShopItem => ({
  key: `upgrade:${stage}`,
  label: "version suivante",
  price: (s) => mouliUpgradeCost(s, stage),
  apply: (s) => upgradeMouli(s, stage),
  intent: (count) => ({ type: "upgradeMouli", stage, count }),
});

export interface Quote {
  /** Purchases possible, ignoring money (less than asked if locked or at the max). */
  count: number;
  cost: number;
  /** Why fewer than asked can be bought, ignoring money. */
  error: string | null;
}

/** Price of `count` purchases in a row, whatever the money. */
export function quote(state: GameState, item: ShopItem, count: number): Quote {
  let s = state;
  let cost = 0;
  for (let i = 0; i < count; i++) {
    const price = item.price(s);
    // Give exactly the price, so only non-money rules can refuse.
    const funded = cloneState(s);
    funded.money = price;
    const r = item.apply(funded);
    if (!r.ok) return { count: i, cost, error: r.error };
    cost += price;
    s = r.state;
  }
  return { count, cost, error: null };
}

/** How many purchases the current money pays for, up to `max`. */
export function maxAffordable(state: GameState, item: ShopItem, max: number): number {
  let s = state;
  for (let i = 0; i < max; i++) {
    const r = item.apply(s);
    if (!r.ok) return i;
    s = r.state;
  }
  return max;
}
