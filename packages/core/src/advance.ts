import { BALANCE, type Balance } from "./config";
import { computeRates, trainingSeconds } from "./economy";
import { cloneState, type GameState } from "./state";

/**
 * Move the state forward by `seconds`, stopping at the end of the season.
 * Rates are constant between level-ups, so the state is integrated exactly
 * segment by segment: advance(s, a + b) equals advance(advance(s, a), b).
 */
export function advance(state: GameState, seconds: number, cfg: Balance = BALANCE): GameState {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError(`advance: seconds must be a finite number >= 0, got ${seconds}`);
  }
  const s = cloneState(state);
  const end = Math.min(s.time + seconds, cfg.seasonSeconds);
  completeTrainings(s, cfg);
  while (s.time < end) {
    let next = end;
    for (const dev of s.devs) {
      if (dev.training && dev.training.levelEndsAt < next) next = dev.training.levelEndsAt;
    }
    integrate(s, next - s.time, cfg);
    s.time = next;
    completeTrainings(s, cfg);
  }
  return s;
}

function completeTrainings(s: GameState, cfg: Balance): void {
  for (const dev of s.devs) {
    while (dev.training && dev.training.levelEndsAt <= s.time) {
      dev.level += 1;
      if (dev.level >= dev.training.targetLevel) dev.training = null;
      else dev.training.levelEndsAt += trainingSeconds(dev.level, cfg);
    }
  }
}

function integrate(s: GameState, dt: number, cfg: Balance): void {
  if (dt <= 0) return;
  const r = computeRates(s, cfg);
  const earned = r.revenuePerSecond * dt;

  // Tiers unlock on cumulative revenue. Revenue grows linearly within a segment,
  // so the exact unlock time is known.
  let tier = cfg.tiers[s.tier + 1];
  while (tier && s.revenue + earned >= tier.revenue) {
    s.tier += 1;
    s.tierUnlockedAt.push(s.time + (tier.revenue - s.revenue) / r.revenuePerSecond);
    tier = cfg.tiers[s.tier + 1];
  }

  s.revenue += earned;
  s.money += r.netPerSecond * dt;
  s.stats.locWritten += r.locPerSecond * dt;
  s.stats.bugsShipped += r.bugsPerSecond * dt;
}
