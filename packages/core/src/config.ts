// Every balance number of the game lives in this file.
// Units: money in EUR, time in seconds, production in LoC (lines of code).

export const MINUTE = 60;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export type HireKind = "junior" | "confirme" | "senior";
export type StageId = "loc" | "files" | "projects" | "products";

export interface HireKindConfig {
  name: string;
  /** Training level the dev starts at. */
  level: number;
  /** Multiplier on the headcount-based hire cost. */
  costMultiplier: number;
  /** Company tier required to hire this kind. */
  tier: number;
}

export interface StrictnessConfig {
  name: string;
  /** Fraction of the remaining bugs caught by the stage. */
  catchRate: number;
  /** Multiplier on the stage throughput: stricter is slower. */
  speed: number;
}

export interface StageConfig {
  id: StageId;
  name: string;
  /** Company tier required to buy the first instance. */
  tier: number;
  /** LoC/s one instance processes at speed 1. */
  throughputPerInstance: number;
  /** EUR earned per bug-free LoC shipped after passing this stage. */
  valuePerLoc: number;
  /** Instance n (0-based) costs baseCost * (n + 1) ^ costExponent. */
  baseCost: number;
  costExponent: number;
  /** EUR/s paid for each instance, used or not. */
  upkeepPerSecond: number;
  /** Version v (0-based) costs upgradeBaseCost * mouliUpgrade.costGrowth ^ v. */
  upgradeBaseCost: number;
}

export interface TierConfig {
  name: string;
  /** Cumulative revenue (EUR) needed to reach this tier. */
  revenue: number;
}

export interface Balance {
  seasonSeconds: number;
  start: { money: number; juniors: number; rooms: number };
  dev: {
    /** LoC/s of an untrained junior. */
    baseLocPerSecond: number;
    /** Production multiplier gained per training level. */
    perfPerLevel: number;
    baseSalaryPerSecond: number;
    /** Salary multiplier per training level. Must stay well below perfPerLevel. */
    salaryPerLevel: number;
  };
  /** Display name per training level. Index 0 is an untrained junior; the last index is the max level. */
  levels: readonly string[];
  hire: {
    /** Hiring with h people already in the company costs baseCost * costGrowth ^ h (times the kind multiplier). */
    baseCost: number;
    costGrowth: number;
    kinds: Readonly<Record<HireKind, HireKindConfig>>;
  };
  training: {
    /** Going from level L to L + 1 takes baseSeconds * durationGrowth ^ L. */
    baseSeconds: number;
    durationGrowth: number;
    /** Going from level L to L + 1 costs baseCost * costGrowth ^ L. */
    baseCost: number;
    costGrowth: number;
  };
  rooms: {
    /** Each room trains one dev at a time. Room r (0-based, counting the free ones) costs baseCost * costGrowth ^ (r - start). */
    baseCost: number;
    costGrowth: number;
    max: number;
  };
  /** Bugs per LoC as written, in [0, 1]. Quality of shipped work is 1 - bug density. */
  initialBugDensity: number;
  /** EUR per bug-free LoC shipped without passing any mouli. */
  rawValuePerLoc: number;
  strictness: readonly StrictnessConfig[];
  defaultStrictness: number;
  /** Each version multiplies the throughput of every instance of a stage. */
  mouliUpgrade: { throughputFactor: number; costGrowth: number };
  /** Pipeline order: LoC go through stages[0], then stages[1], and so on. */
  stages: readonly StageConfig[];
  /** tiers[0] is the starting tier. */
  tiers: readonly TierConfig[];
}

export const BALANCE: Balance = {
  seasonSeconds: 14 * DAY,
  start: { money: 20, juniors: 2, rooms: 1 },
  dev: {
    baseLocPerSecond: 1,
    perfPerLevel: 2,
    baseSalaryPerSecond: 0.15,
    salaryPerLevel: 1.6,
  },
  levels: [
    "Junior",
    "Piscine",
    "Tek 1",
    "Tek 2",
    "Tek 3",
    "Tek 4",
    "Tek 5",
    "Lead",
    "Staff",
    "Principal",
    "Fellow",
    "Légende",
  ],
  hire: {
    baseCost: 25,
    costGrowth: 1.1,
    kinds: {
      junior: { name: "Junior", level: 0, costMultiplier: 1, tier: 0 },
      confirme: { name: "Confirmé", level: 3, costMultiplier: 3, tier: 2 },
      senior: { name: "Senior", level: 6, costMultiplier: 12, tier: 4 },
    },
  },
  training: {
    baseSeconds: 8 * MINUTE,
    durationGrowth: 2,
    baseCost: 15,
    costGrowth: 3.5,
  },
  rooms: { baseCost: 300, costGrowth: 1.5, max: 50 },
  initialBugDensity: 0.6,
  rawValuePerLoc: 1,
  strictness: [
    { name: "Laxiste", catchRate: 0.25, speed: 1 },
    { name: "Normale", catchRate: 0.45, speed: 0.8 },
    { name: "Stricte", catchRate: 0.65, speed: 0.6 },
    { name: "Impitoyable", catchRate: 0.85, speed: 0.4 },
  ],
  defaultStrictness: 1,
  mouliUpgrade: { throughputFactor: 2, costGrowth: 3 },
  stages: [
    {
      id: "loc",
      name: "Mouli LoC",
      tier: 0,
      throughputPerInstance: 5,
      valuePerLoc: 1.5,
      baseCost: 50,
      costExponent: 1.2,
      upkeepPerSecond: 0.2,
      upgradeBaseCost: 500,
    },
    {
      id: "files",
      name: "Mouli fichiers",
      tier: 1,
      throughputPerInstance: 2.5,
      valuePerLoc: 3,
      baseCost: 500,
      costExponent: 1.2,
      upkeepPerSecond: 0.3,
      upgradeBaseCost: 5_000,
    },
    {
      id: "projects",
      name: "Mouli projets",
      tier: 3,
      throughputPerInstance: 1.5,
      valuePerLoc: 6,
      baseCost: 6_000,
      costExponent: 1.2,
      upkeepPerSecond: 0.4,
      upgradeBaseCost: 60_000,
    },
    {
      id: "products",
      name: "Mouli produits",
      tier: 5,
      throughputPerInstance: 1,
      valuePerLoc: 12,
      baseCost: 80_000,
      costExponent: 1.2,
      upkeepPerSecond: 0.6,
      upgradeBaseCost: 800_000,
    },
  ],
  tiers: [
    { name: "Garage", revenue: 0 },
    { name: "Startup", revenue: 2_000 },
    { name: "PME", revenue: 3_000_000 },
    { name: "Scale-up", revenue: 500_000_000 },
    { name: "ETI", revenue: 8_000_000_000 },
    { name: "Licorne", revenue: 80_000_000_000 },
  ],
};
