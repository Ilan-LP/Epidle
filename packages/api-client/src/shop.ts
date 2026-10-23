import {
  BALANCE,
  type Balance,
  buyMouli,
  buyRoom,
  cloneState,
  type GameState,
  type HireKind,
  hire,
  hireCost,
  INTENT_ERROR_MESSAGES,
  type IntentError,
  type IntentResult,
  mouliCost,
  mouliUpgradeCost,
  roomCost,
  type StageId,
  upgradeMouli,
} from "@epidle/core";
import type { Intent } from "./api";
import { tierName } from "./format";
import { affordableIn } from "./projection";

// Bulk prices are computed by running the core intents, so the shop shows exactly what the
// server will charge for "x10" (each purchase makes the next one more expensive).

export interface ShopItem {
  key: string;
  label: string;
  /** Cost of the next purchase, with the balance of the week. */
  price: (s: GameState, cfg: Balance) => number;
  apply: (s: GameState, cfg: Balance) => IntentResult;
  intent: (count: number) => Intent;
}

export const hireItem = (kind: HireKind): ShopItem => ({
  key: `hire:${kind}`,
  label: BALANCE.hire.kinds[kind].name,
  price: (s, cfg) => hireCost(s, kind, cfg),
  apply: (s, cfg) => hire(s, kind, cfg),
  intent: (count) => ({ type: "hire", kind, count }),
});

export const roomItem: ShopItem = {
  key: "room",
  label: "Salle de formation",
  price: (s, cfg) => roomCost(s, cfg),
  apply: (s, cfg) => buyRoom(s, cfg),
  intent: (count) => ({ type: "buyRoom", count }),
};

export const mouliItem = (stage: StageId): ShopItem => ({
  key: `mouli:${stage}`,
  label: "+1 instance",
  price: (s, cfg) => mouliCost(s, stage, cfg),
  apply: (s, cfg) => buyMouli(s, stage, cfg),
  intent: (count) => ({ type: "buyMouli", stage, count }),
});

export const upgradeItem = (stage: StageId): ShopItem => ({
  key: `upgrade:${stage}`,
  label: "version suivante",
  price: (s, cfg) => mouliUpgradeCost(s, stage, cfg),
  apply: (s, cfg) => upgradeMouli(s, stage, cfg),
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
export function quote(
  state: GameState,
  item: ShopItem,
  count: number,
  cfg: Balance = BALANCE,
): Quote {
  let s = state;
  let cost = 0;
  for (let i = 0; i < count; i++) {
    const price = item.price(s, cfg);
    // Give exactly the price, so only non-money rules can refuse.
    const funded = cloneState(s);
    funded.money = price;
    const r = item.apply(funded, cfg);
    if (!r.ok) return { count: i, cost, error: r.error };
    cost += price;
    s = r.state;
  }
  return { count, cost, error: null };
}

/** How many purchases the current money pays for, up to `max`. */
export function maxAffordable(
  state: GameState,
  item: ShopItem,
  max: number,
  cfg: Balance = BALANCE,
): number {
  let s = state;
  for (let i = 0; i < max; i++) {
    const r = item.apply(s, cfg);
    if (!r.ok) return i;
    s = r.state;
  }
  return max;
}

export const MODES = [1, 10, 100, "max"] as const;
export type Mode = (typeof MODES)[number];
/** Server limit for one intent. */
export const MAX_COUNT = 100;

export interface ShopRow {
  /** Web shortcut, "⇧5" for Shift+5. */
  hint: string;
  item: ShopItem;
  /** Shown in the log. */
  name: string;
  /** Tier required, to explain a lock. */
  tier: number;
}

function sections(): { title: string; rows: ShopRow[] }[] {
  return [
    {
      title: "Recrutement",
      rows: (["junior", "confirme", "senior"] as const).map((kind, i) => ({
        hint: String(i + 1),
        item: hireItem(kind),
        name: `embauche ${BALANCE.hire.kinds[kind].name}`,
        tier: BALANCE.hire.kinds[kind].tier,
      })),
    },
    {
      title: "Formation",
      rows: [{ hint: "4", item: roomItem, name: "achat salle", tier: 0 }],
    },
    {
      title: "Moulis",
      rows: BALANCE.stages.flatMap((stage, i) => [
        {
          hint: String(i + 5),
          item: { ...mouliItem(stage.id), label: `${stage.name} +1` },
          name: `${stage.name} +1 instance`,
          tier: stage.tier,
        },
        {
          hint: `⇧${i + 5}`,
          item: {
            ...upgradeItem(stage.id),
            label: `${stage.name} v+1 (débit x${BALANCE.mouliUpgrade.throughputFactor})`,
          },
          name: `${stage.name} version suivante`,
          tier: stage.tier,
        },
      ]),
    },
  ];
}

/** The shop catalogue, in display order. Hints are the web shortcuts (⇧ = Shift). */
export const SHOP_SECTIONS = sections();

export interface Offer {
  row: ShopRow;
  count: number;
  cost: number;
  /** null when buyable now, else why not. */
  blocked: string | null;
  wait: number | null;
}

/** What `mode` buys of a row right now, and why not if it can't. */
export function offer(
  row: ShopRow,
  state: GameState,
  net: number,
  mode: Mode,
  cfg: Balance,
): Offer {
  const asked = mode === "max" ? Math.max(1, maxAffordable(state, row.item, MAX_COUNT, cfg)) : mode;
  const q = quote(state, row.item, asked, cfg);
  if (q.count === 0) {
    const error = q.error as IntentError | null;
    const blocked =
      error === "locked"
        ? `palier ${tierName(row.tier)}`
        : error
          ? INTENT_ERROR_MESSAGES[error]
          : "?";
    return { row, count: 0, cost: 0, blocked, wait: null };
  }
  const wait = affordableIn(q.cost, state.money, net);
  return { row, count: q.count, cost: q.cost, blocked: wait === 0 ? null : "", wait };
}
