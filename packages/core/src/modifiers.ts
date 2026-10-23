import { advance } from "./advance";
import { BALANCE, type Balance } from "./config";
import type { GameState } from "./state";

// Weekly modifiers: a week of the season can change a few balance numbers for everyone
// ("Semaine Rush": devs code faster but write more bugs). A modifier is a set of multipliers
// applied to the balance, so every rule keeps working unchanged with the modified config.

/** Multipliers, 1 when absent. */
export interface Effects {
  /** LoC/s of every dev. */
  devSpeed?: number;
  /** Salary of every dev. */
  salary?: number;
  /** Duration of every training level. */
  trainingTime?: number;
  trainingCost?: number;
  hireCost?: number;
  roomCost?: number;
  /** Price of mouli instances and versions. */
  mouliCost?: number;
  /** Throughput of every mouli instance. */
  mouliSpeed?: number;
  /** Bugs per LoC as written (capped at 1). */
  bugs?: number;
  /** EUR per bug-free LoC shipped, at every stage. */
  value?: number;
}

export type EffectName = keyof Effects;

export const EFFECT_NAMES: readonly EffectName[] = [
  "devSpeed",
  "salary",
  "trainingTime",
  "trainingCost",
  "hireCost",
  "roomCost",
  "mouliCost",
  "mouliSpeed",
  "bugs",
  "value",
];

/** Allowed range of a multiplier: a modifier spices up a week, it does not rewrite the game. */
export const EFFECT_RANGE = { min: 0.25, max: 4 } as const;

export interface Modifier {
  id: string;
  /** French, e.g. "Semaine Rush". */
  name: string;
  /** French, one sentence for the announcement. */
  description: string;
  effects: Effects;
}

/** The modifier of each week of a season, null for a normal week. */
export type SeasonWeeks = readonly (Modifier | null)[];

export function applyEffects(effects: Effects, cfg: Balance = BALANCE): Balance {
  const m = (name: EffectName) => effects[name] ?? 1;
  return {
    ...cfg,
    dev: {
      ...cfg.dev,
      baseLocPerSecond: cfg.dev.baseLocPerSecond * m("devSpeed"),
      baseSalaryPerSecond: cfg.dev.baseSalaryPerSecond * m("salary"),
    },
    training: {
      ...cfg.training,
      baseSeconds: cfg.training.baseSeconds * m("trainingTime"),
      baseCost: cfg.training.baseCost * m("trainingCost"),
    },
    hire: { ...cfg.hire, baseCost: cfg.hire.baseCost * m("hireCost") },
    rooms: { ...cfg.rooms, baseCost: cfg.rooms.baseCost * m("roomCost") },
    initialBugDensity: Math.min(1, cfg.initialBugDensity * m("bugs")),
    rawValuePerLoc: cfg.rawValuePerLoc * m("value"),
    stages: cfg.stages.map((stage) => ({
      ...stage,
      throughputPerInstance: stage.throughputPerInstance * m("mouliSpeed"),
      valuePerLoc: stage.valuePerLoc * m("value"),
      baseCost: stage.baseCost * m("mouliCost"),
      upgradeBaseCost: stage.upgradeBaseCost * m("mouliCost"),
    })),
  };
}

export const weeksPerSeason = (cfg: Balance = BALANCE): number =>
  Math.ceil(cfg.seasonSeconds / cfg.weekSeconds);

/** Week of the season (0-based) at season time `time`. The season end belongs to the last week. */
export function weekIndex(time: number, cfg: Balance = BALANCE): number {
  return Math.min(Math.max(Math.floor(time / cfg.weekSeconds), 0), weeksPerSeason(cfg) - 1);
}

const applied = new WeakMap<Balance, WeakMap<Modifier, Balance>>();

/** The balance of week `week`: the base one when the week has no modifier. Memoized. */
export function weekBalance(weeks: SeasonWeeks, week: number, cfg: Balance = BALANCE): Balance {
  const modifier = weeks[week];
  if (!modifier) return cfg;
  let byModifier = applied.get(cfg);
  if (!byModifier) {
    byModifier = new WeakMap();
    applied.set(cfg, byModifier);
  }
  let out = byModifier.get(modifier);
  if (!out) {
    out = applyEffects(modifier.effects, cfg);
    byModifier.set(modifier, out);
  }
  return out;
}

/** The balance in force at season time `time`: use it for rates, prices and intents. */
export const balanceAt = (weeks: SeasonWeeks, time: number, cfg: Balance = BALANCE): Balance =>
  weekBalance(weeks, weekIndex(time, cfg), cfg);

/**
 * `advance` across week boundaries: each week is integrated with its own balance. Same
 * guarantee as `advance`: advanceSeason(s, a + b) equals advanceSeason(advanceSeason(s, a), b).
 */
export function advanceSeason(
  state: GameState,
  seconds: number,
  weeks: SeasonWeeks,
  cfg: Balance = BALANCE,
): GameState {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`advanceSeason: seconds must be a finite number >= 0, got ${seconds}`);
  }
  const end = Math.min(state.time + seconds, cfg.seasonSeconds);
  let s = state;
  // Explicit week counter: never relies on s.time landing exactly on a boundary.
  for (let week = weekIndex(state.time, cfg); ; week++) {
    const last = week >= weeksPerSeason(cfg) - 1;
    const segmentEnd = last ? end : Math.min((week + 1) * cfg.weekSeconds, end);
    s = advance(s, Math.max(0, segmentEnd - s.time), weekBalance(weeks, week, cfg));
    if (last || segmentEnd >= end) return s;
  }
}

/** Why a modifier is invalid, null if it is fine. For config files written by hand. */
export function modifierError(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "must be an object";
  const m = value as Record<string, unknown>;
  if (typeof m.id !== "string" || !/^[a-z0-9-]{1,32}$/.test(m.id)) return "id: [a-z0-9-]{1,32}";
  if (typeof m.name !== "string" || m.name.length < 1 || m.name.length > 40) {
    return `${m.id}: name must be 1-40 characters`;
  }
  if (typeof m.description !== "string" || m.description.length > 200) {
    return `${m.id}: description must be at most 200 characters`;
  }
  if (typeof m.effects !== "object" || m.effects === null) return `${m.id}: effects missing`;
  for (const [name, factor] of Object.entries(m.effects)) {
    if (!EFFECT_NAMES.includes(name as EffectName)) return `${m.id}: unknown effect ${name}`;
    if (typeof factor !== "number" || !(factor >= EFFECT_RANGE.min && factor <= EFFECT_RANGE.max)) {
      return `${m.id}: ${name} must be between ${EFFECT_RANGE.min} and ${EFFECT_RANGE.max}`;
    }
  }
  return null;
}
