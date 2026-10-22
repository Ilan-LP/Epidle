import { BALANCE, type Balance, type HireKind, type StageId } from "./config";
import type { Dev, GameState } from "./state";

export const maxLevel = (cfg: Balance = BALANCE): number => cfg.levels.length - 1;

export function devLocPerSecond(level: number, cfg: Balance = BALANCE): number {
  return cfg.dev.baseLocPerSecond * cfg.dev.perfPerLevel ** level;
}

export function devSalaryPerSecond(level: number, cfg: Balance = BALANCE): number {
  return cfg.dev.baseSalaryPerSecond * cfg.dev.salaryPerLevel ** level;
}

export function hireCost(state: GameState, kind: HireKind, cfg: Balance = BALANCE): number {
  return (
    cfg.hire.baseCost *
    cfg.hire.costGrowth ** state.devs.length *
    cfg.hire.kinds[kind].costMultiplier
  );
}

/** Duration of the training from `level` to `level + 1`. */
export function trainingSeconds(level: number, cfg: Balance = BALANCE): number {
  return cfg.training.baseSeconds * cfg.training.durationGrowth ** level;
}

/** Cost of the training from `level` to `level + 1`. */
export function trainingCost(level: number, cfg: Balance = BALANCE): number {
  return cfg.training.baseCost * cfg.training.costGrowth ** level;
}

/** Total duration and cost of a training from `from` to `to`, one level after another. */
export function trainingPlan(
  from: number,
  to: number,
  cfg: Balance = BALANCE,
): { seconds: number; cost: number } {
  let seconds = 0;
  let cost = 0;
  for (let level = from; level < to; level++) {
    seconds += trainingSeconds(level, cfg);
    cost += trainingCost(level, cfg);
  }
  return { seconds, cost };
}

export function roomCost(state: GameState, cfg: Balance = BALANCE): number {
  return cfg.rooms.baseCost * cfg.rooms.costGrowth ** (state.rooms - cfg.start.rooms);
}

export function stageIndex(stageId: StageId, cfg: Balance = BALANCE): number {
  return cfg.stages.findIndex((s) => s.id === stageId);
}

export function mouliCost(state: GameState, stageId: StageId, cfg: Balance = BALANCE): number {
  const i = stageIndex(stageId, cfg);
  const stage = cfg.stages[i];
  const owned = state.stages[i]?.instances ?? 0;
  if (!stage) return Number.POSITIVE_INFINITY;
  return stage.baseCost * (owned + 1) ** stage.costExponent;
}

export function mouliUpgradeCost(
  state: GameState,
  stageId: StageId,
  cfg: Balance = BALANCE,
): number {
  const i = stageIndex(stageId, cfg);
  const stage = cfg.stages[i];
  if (!stage) return Number.POSITIVE_INFINITY;
  return stage.upgradeBaseCost * cfg.mouliUpgrade.costGrowth ** (state.stages[i]?.version ?? 0);
}

export const isTraining = (dev: Dev): boolean => dev.training !== null;

export const roomsInUse = (state: GameState): number => state.devs.filter(isTraining).length;

export interface StageFlow {
  /** LoC/s this stage can process with its instances and strictness. */
  capacity: number;
  /** LoC/s arriving at this stage. */
  input: number;
  /** LoC/s actually processed. The rest ships right away, without the checks of this stage. */
  processed: number;
}

export interface Rates {
  locPerSecond: number;
  revenuePerSecond: number;
  salaryPerSecond: number;
  upkeepPerSecond: number;
  /** revenue - salaries - upkeep. Can be negative. */
  netPerSecond: number;
  bugsPerSecond: number;
  /** Bug-free share of shipped LoC, in [0, 1]. */
  quality: number;
  stages: StageFlow[];
}

/**
 * Instant rates for a state. Constant between two events (intent, training completion),
 * which is what lets `advance` integrate exactly.
 *
 * LoC flow through the stages in order. A stage processes at most its capacity; the overflow
 * ships at the value of the last stage it passed, with the bugs still in it.
 */
export function computeRates(state: GameState, cfg: Balance = BALANCE): Rates {
  // Count devs per level first: far fewer pow calls than one per dev.
  const paid = new Array<number>(cfg.levels.length).fill(0);
  const working = new Array<number>(cfg.levels.length).fill(0);
  for (const dev of state.devs) {
    paid[dev.level] = (paid[dev.level] ?? 0) + 1;
    if (!isTraining(dev)) working[dev.level] = (working[dev.level] ?? 0) + 1;
  }
  let loc = 0;
  let salary = 0;
  for (let level = 0; level < paid.length; level++) {
    if (paid[level]) salary += (paid[level] ?? 0) * devSalaryPerSecond(level, cfg);
    if (working[level]) loc += (working[level] ?? 0) * devLocPerSecond(level, cfg);
  }

  let upkeep = 0;
  let revenue = 0;
  let bugs = 0;
  let flow = loc;
  let density = cfg.initialBugDensity;
  let value = cfg.rawValuePerLoc;
  const stages: StageFlow[] = [];

  const ship = (amount: number) => {
    revenue += amount * value * (1 - density);
    bugs += amount * density;
  };

  cfg.stages.forEach((stage, i) => {
    const s = state.stages[i];
    const instances = s?.instances ?? 0;
    const strictness = cfg.strictness[s?.strictness ?? cfg.defaultStrictness];
    upkeep += instances * stage.upkeepPerSecond;
    const perInstance =
      stage.throughputPerInstance * cfg.mouliUpgrade.throughputFactor ** (s?.version ?? 0);
    const capacity = strictness ? instances * perInstance * strictness.speed : 0;
    const processed = Math.min(flow, capacity);
    stages.push({ capacity, input: flow, processed });
    ship(flow - processed);
    flow = processed;
    if (strictness) density *= 1 - strictness.catchRate;
    value = stage.valuePerLoc;
  });
  ship(flow);

  return {
    locPerSecond: loc,
    revenuePerSecond: revenue,
    salaryPerSecond: salary,
    upkeepPerSecond: upkeep,
    netPerSecond: revenue - salary - upkeep,
    bugsPerSecond: bugs,
    quality: loc > 0 ? 1 - bugs / loc : 1,
    stages,
  };
}
