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
