import { BALANCE, type Balance, type HireKind } from "./config";

export interface Dev {
  id: number;
  /** How the dev was hired. Display only: perf and salary depend on level. */
  kind: HireKind;
  level: number;
  /** Null when working. While training the dev writes no code but is still paid. */
  training: Training | null;
}

export interface Training {
  /** The dev stays in the room, one level after another, until this level. */
  targetLevel: number;
  /** Season time at which the current level (level + 1) is reached. */
  levelEndsAt: number;
}

export interface StageState {
  instances: number;
  /** Index into Balance.strictness. */
  strictness: number;
  /** Number of upgrades bought. Throughput is multiplied by mouliUpgrade.throughputFactor ^ version. */
  version: number;
}

export interface GameState {
  /** Seconds since the season started. */
  time: number;
  money: number;
  /** Cumulative revenue, the season score. Never decreases. */
  revenue: number;
  devs: Dev[];
  nextDevId: number;
  rooms: number;
  /** Same order as Balance.stages. */
  stages: StageState[];
  /** Highest tier reached. */
  tier: number;
  /** Season time at which each reached tier was unlocked. tierUnlockedAt[0] is 0. */
  tierUnlockedAt: number[];
  stats: { locWritten: number; bugsShipped: number };
}

export function createInitialState(cfg: Balance = BALANCE): GameState {
  const devs: Dev[] = [];
  for (let i = 0; i < cfg.start.juniors; i++) {
    devs.push({ id: i + 1, kind: "junior", level: 0, training: null });
  }
  return {
    time: 0,
    money: cfg.start.money,
    revenue: 0,
    devs,
    nextDevId: devs.length + 1,
    rooms: cfg.start.rooms,
    stages: cfg.stages.map(() => ({ instances: 0, strictness: cfg.defaultStrictness, version: 0 })),
    tier: 0,
    tierUnlockedAt: [0],
    stats: { locWritten: 0, bugsShipped: 0 },
  };
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/**
 * Whether a value read back from storage is a usable state: right shape, finite numbers,
 * levels and stages within the balance. Never throws.
 */
export function isGameState(value: unknown, cfg: Balance = BALANCE): value is GameState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  const maxLevel = cfg.levels.length - 1;
  const devOk = (d: unknown): boolean => {
    if (typeof d !== "object" || d === null) return false;
    const dev = d as Record<string, unknown>;
    if (!isCount(dev.id) || !isCount(dev.level) || (dev.level as number) > maxLevel) return false;
    if (typeof dev.kind !== "string" || !Object.hasOwn(cfg.hire.kinds, dev.kind)) return false;
    if (dev.training === null) return true;
    if (typeof dev.training !== "object" || dev.training === undefined) return false;
    const t = dev.training as Record<string, unknown>;
    return (
      isCount(t.targetLevel) &&
      (t.targetLevel as number) <= maxLevel &&
      isFiniteNumber(t.levelEndsAt)
    );
  };
  const stageOk = (st: unknown): boolean => {
    if (typeof st !== "object" || st === null) return false;
    const stage = st as Record<string, unknown>;
    return (
      isCount(stage.instances) &&
      isCount(stage.version) &&
      isCount(stage.strictness) &&
      (stage.strictness as number) < cfg.strictness.length
    );
  };
  const stats = s.stats as Record<string, unknown> | null | undefined;
  return (
    isFiniteNumber(s.time) &&
    isFiniteNumber(s.money) &&
    isFiniteNumber(s.revenue) &&
    isCount(s.nextDevId) &&
    isCount(s.rooms) &&
    isCount(s.tier) &&
    (s.tier as number) < cfg.tiers.length &&
    Array.isArray(s.devs) &&
    s.devs.every(devOk) &&
    Array.isArray(s.stages) &&
    s.stages.length === cfg.stages.length &&
    s.stages.every(stageOk) &&
    Array.isArray(s.tierUnlockedAt) &&
    s.tierUnlockedAt.every(isFiniteNumber) &&
    typeof stats === "object" &&
    stats !== null &&
    isFiniteNumber(stats.locWritten) &&
    isFiniteNumber(stats.bugsShipped)
  );
}

/** Deep copy. States are treated as immutable: every core function returns a new one. */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    devs: state.devs.map((d) => ({ ...d, training: d.training && { ...d.training } })),
    stages: state.stages.map((s) => ({ ...s })),
    tierUnlockedAt: [...state.tierUnlockedAt],
    stats: { ...state.stats },
  };
}
