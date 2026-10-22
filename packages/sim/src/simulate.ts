import {
  advance,
  BALANCE,
  type Balance,
  computeRates,
  createInitialState,
  DAY,
  type GameState,
} from "@epidle/core";
import { playVisit } from "./bot";

export interface DailySnapshot {
  day: number;
  revenue: number;
  netPerSecond: number;
  devs: number;
  avgLevel: number;
  tier: number;
}

export interface SimResult {
  visitInterval: number;
  final: GameState;
  /**
   * Saturation: season time from which the bot found nothing worth doing (no action paying back
   * before the season end, at any price) for 24 hours straight. Null if it never happens.
   */
  saturatedAt: number | null;
  /**
   * First day (0-based) on which most visits found nothing worth buying at any price: money is no
   * longer the constraint, the bot only waits for trainings. Null if it never happens.
   */
  moneyIdleDay: number | null;
  minMoney: number;
  /** Largest absolute number seen in the state over the season. */
  maxMagnitude: number;
  allFinite: boolean;
  daily: DailySnapshot[];
  actions: number;
}

function magnitudes(s: GameState, cfg: Balance): number[] {
  return [
    s.money,
    s.revenue,
    s.stats.locWritten,
    s.stats.bugsShipped,
    computeRates(s, cfg).netPerSecond,
  ];
}

export function simulate(visitInterval: number, cfg: Balance = BALANCE): SimResult {
  let state = createInitialState(cfg);
  const visitsPerDay = new Map<number, { total: number; idle: number }>();
  let lastUseful = 0;
  let saturatedAt: number | null = null;
  let minMoney = state.money;
  let maxMagnitude = 0;
  let allFinite = true;
  let actions = 0;
  const daily: DailySnapshot[] = [];

  const observe = (s: GameState) => {
    minMoney = Math.min(minMoney, s.money);
    for (const m of magnitudes(s, cfg)) {
      if (!Number.isFinite(m)) allFinite = false;
      maxMagnitude = Math.max(maxMagnitude, Math.abs(m));
    }
  };

  const snapshot = (s: GameState) => {
    const levels = s.devs.reduce((sum, d) => sum + d.level, 0);
    daily.push({
      day: Math.round(s.time / DAY),
      revenue: s.revenue,
      netPerSecond: computeRates(s, cfg).netPerSecond,
      devs: s.devs.length,
      avgLevel: s.devs.length ? levels / s.devs.length : 0,
      tier: s.tier,
    });
  };

  while (state.time < cfg.seasonSeconds) {
    const visit = playVisit(state, visitInterval, cfg);
    state = visit.state;
    actions += visit.actions;
    const day = Math.floor(state.time / DAY);
    const counts = visitsPerDay.get(day) ?? { total: 0, idle: 0 };
    counts.total += 1;
    if (visit.nothingWorthBuying) counts.idle += 1;
    visitsPerDay.set(day, counts);
    if (!visit.nothingWorthBuying) lastUseful = state.time;
    else if (saturatedAt === null && state.time - lastUseful >= DAY) saturatedAt = lastUseful;
    observe(state);
    const nextVisit = Math.min(state.time + visitInterval, cfg.seasonSeconds);
    const crossesDay = Math.floor(nextVisit / DAY) > Math.floor(state.time / DAY);
    state = advance(state, nextVisit - state.time, cfg);
    observe(state);
    if (crossesDay) snapshot(state);
  }

  let moneyIdleDay: number | null = null;
  for (const [day, { total, idle }] of visitsPerDay) {
    if (idle * 2 > total) {
      moneyIdleDay = day;
      break;
    }
  }

  return {
    visitInterval,
    final: state,
    saturatedAt,
    moneyIdleDay,
    minMoney,
    maxMagnitude,
    allFinite,
    daily,
    actions,
  };
}
