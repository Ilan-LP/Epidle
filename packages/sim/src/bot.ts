import {
  BALANCE,
  type Balance,
  buyMouli,
  buyRoom,
  computeRates,
  devLocPerSecond,
  devSalaryPerSecond,
  type GameState,
  type HireKind,
  hire,
  hireCost,
  type IntentResult,
  isTraining,
  maxLevel,
  mouliCost,
  mouliUpgradeCost,
  roomCost,
  roomsInUse,
  setStrictness,
  train,
  trainingPlan,
  upgradeMouli,
} from "@epidle/core";

export interface Candidate {
  label: string;
  cost: number;
  /** Seconds until the action has paid for itself (cost and lost production included). */
  payback: number;
  apply: (state: GameState) => IntentResult;
}

const net = (state: GameState, cfg: Balance) => computeRates(state, cfg).netPerSecond;

/**
 * Prices production changes (hires, training) at the current average value per LoC:
 * a player expects to grow the pipeline along with production, so extra LoC are worth the
 * average, not the raw value of overflow. Closed form, so the bot stays fast.
 */
interface Pricing {
  /** EUR/s earned by the LoC of one working dev of a given level. */
  locValue: (level: number) => number;
  /** Net EUR/s a dev of this level brings while working. */
  devNet: (level: number) => number;
}

function pricing(state: GameState, cfg: Balance): Pricing {
  const r = computeRates(state, cfg);
  const perLoc = r.locPerSecond > 0 ? r.revenuePerSecond / r.locPerSecond : cfg.rawValuePerLoc;
  const locValue = (level: number) => devLocPerSecond(level, cfg) * perLoc;
  return { locValue, devNet: (level) => locValue(level) - devSalaryPerSecond(level, cfg) };
}

/** Lets the bot price actions it cannot afford yet. */
const rich = (state: GameState): GameState => ({ ...state, money: Number.POSITIVE_INFINITY });

/**
 * Smallest target that keeps the room busy until the next visit: shorter trainings would leave
 * the room empty while the player is away.
 */
function minTrainingTarget(level: number, visitInterval: number, cfg: Balance): number {
  let target = level + 1;
  while (target < maxLevel(cfg) && trainingPlan(level, target, cfg).seconds < visitInterval) {
    target += 1;
  }
  return target;
}

interface TrainingOption {
  target: number;
  cost: number;
  seconds: number;
  /** Net income gained once trained. */
  gain: number;
  payback: number;
}

/**
 * Best training (by payback) of a dev at `level`. `loss` is the income lost while training,
 * `gainAt(t)` the income gained once at level t, `extraCost` anything bundled (a hire).
 */
function bestTraining(
  level: number,
  loss: number,
  gainAt: (target: number) => number,
  extraCost: number,
  visitInterval: number,
  cfg: Balance,
): TrainingOption | null {
  let best: TrainingOption | null = null;
  for (let t = minTrainingTarget(level, visitInterval, cfg); t <= maxLevel(cfg); t++) {
    const plan = trainingPlan(level, t, cfg);
    const gain = gainAt(t);
    const cost = extraCost + plan.cost;
    const payback = plan.seconds + (cost + loss * plan.seconds) / gain;
    if (gain > 0 && (!best || payback < best.payback)) {
      best = { target: t, cost, seconds: plan.seconds, gain, payback };
    }
  }
  return best;
}

/** Every action the bot could take now, with its payback. Unaffordable ones included. */
export function candidates(
  state: GameState,
  visitInterval: number,
  cfg: Balance = BALANCE,
): Candidate[] {
  const base = net(state, cfg);
  const price = pricing(state, cfg);
  const out: Candidate[] = [];
  const freeRoom = roomsInUse(state) < state.rooms;
  // Best income gained per second of room time, to price a new room.
  let bestRate = 0;

  for (const kind of Object.keys(cfg.hire.kinds) as HireKind[]) {
    const r = hire(rich(state), kind, cfg);
    if (!r.ok) continue;
    const cost = hireCost(state, kind, cfg);
    const level = cfg.hire.kinds[kind].level;
    out.push({
      label: `hire ${kind}`,
      cost,
      payback: cost / price.devNet(level),
      apply: (s) => hire(s, kind, cfg),
    });
    // A hire is usually meant to be trained: price both together too.
    // While training, the new dev only costs their salary.
    const newDev = r.state.devs.at(-1);
    const t = newDev
      ? bestTraining(level, devSalaryPerSecond(level, cfg), price.devNet, cost, visitInterval, cfg)
      : null;
    if (t) bestRate = Math.max(bestRate, t.gain / t.seconds);
    if (t && newDev && freeRoom) {
      out.push({
        label: `hire ${kind} + train L${newDev.level}->L${t.target}`,
        cost: t.cost,
        payback: t.payback,
        apply: (s) => {
          const h = hire(s, kind, cfg);
          return h.ok ? train(h.state, newDev.id, t.target, cfg) : h;
        },
      });
    }
  }

  for (const stage of cfg.stages) {
    const r = buyMouli(rich(state), stage.id, cfg);
    if (!r.ok) continue;
    const cost = mouliCost(state, stage.id, cfg);
    out.push({
      label: `mouli ${stage.id}`,
      cost,
      payback: cost / (net(r.state, cfg) - base),
      apply: (s) => buyMouli(s, stage.id, cfg),
    });
    const u = upgradeMouli(rich(state), stage.id, cfg);
    if (!u.ok) continue;
    const upgradeCost = mouliUpgradeCost(state, stage.id, cfg);
    out.push({
      label: `upgrade ${stage.id}`,
      cost: upgradeCost,
      payback: upgradeCost / (net(u.state, cfg) - base),
      apply: (s) => upgradeMouli(s, stage.id, cfg),
    });
  }

  // One training candidate per level: devs of the same level are interchangeable.
  const seen = new Set<number>();
  for (const dev of state.devs) {
    if (isTraining(dev) || seen.has(dev.level)) continue;
    seen.add(dev.level);
    const t = bestTraining(
      dev.level,
      price.locValue(dev.level),
      (target) => price.devNet(target) - price.devNet(dev.level),
      0,
      visitInterval,
      cfg,
    );
    if (!t) continue;
    bestRate = Math.max(bestRate, t.gain / t.seconds);
    if (freeRoom) {
      out.push({
        label: `train L${dev.level}->L${t.target}`,
        cost: t.cost,
        payback: t.payback,
        apply: (s) => train(s, dev.id, t.target, cfg),
      });
    }
  }

  // A room is reused all season: kept busy, it adds about bestRate EUR/s of income per second,
  // so after t seconds it has earned bestRate * t^2 / 2.
  if (!freeRoom && bestRate > 0 && state.rooms < cfg.rooms.max) {
    const cost = roomCost(state, cfg);
    out.push({
      label: "room",
      cost,
      payback: Math.sqrt((2 * cost) / bestRate),
      apply: (s) => buyRoom(s, cfg),
    });
  }

  return out.filter((c) => Number.isFinite(c.payback) && c.payback > 0);
}

/** Strictness is free: pick the best level per stage, stage by stage. */
export function optimizeStrictness(state: GameState, cfg: Balance = BALANCE): GameState {
  let s = state;
  for (const stage of cfg.stages) {
    let best = s;
    let bestNet = net(s, cfg);
    for (let level = 0; level < cfg.strictness.length; level++) {
      const r = setStrictness(s, stage.id, level, cfg);
      if (r.ok && net(r.state, cfg) > bestNet + 1e-9) {
        best = r.state;
        bestNet = net(r.state, cfg);
      }
    }
    s = best;
  }
  return s;
}

export interface VisitOutcome {
  state: GameState;
  actions: number;
  /** True when, on arrival, no action paid back before the season end, even with infinite money. */
  nothingWorthBuying: boolean;
}

/**
 * Greedy "best payback first" player. Buys the best action it can afford, as long as it pays
 * back before the season ends. If a better action is unaffordable but will be affordable before
 * the next visit, it saves for it instead of buying worse things.
 */
export function playVisit(
  state: GameState,
  visitInterval: number,
  cfg: Balance = BALANCE,
): VisitOutcome {
  let s = optimizeStrictness(state, cfg);
  let actions = 0;
  let nothingWorthBuying = false;
  for (;;) {
    const remaining = cfg.seasonSeconds - s.time;
    const options = candidates(s, visitInterval, cfg)
      .filter((c) => c.payback <= remaining)
      .sort((a, b) => a.payback - b.payback);
    if (options.length === 0) {
      nothingWorthBuying = actions === 0;
      break;
    }
    const income = net(s, cfg);
    let next: GameState | null = null;
    for (const c of options) {
      if (c.cost <= s.money) {
        const r = c.apply(s);
        if (r.ok) next = r.state;
        break;
      }
      if (income > 0 && (c.cost - s.money) / income <= visitInterval) break;
    }
    if (!next) break;
    s = optimizeStrictness(next, cfg);
    actions += 1;
  }
  return { state: s, actions, nothingWorthBuying };
}
