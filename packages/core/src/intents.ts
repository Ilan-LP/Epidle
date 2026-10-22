import { BALANCE, type Balance, type HireKind, type StageId } from "./config";
import {
  hireCost,
  isTraining,
  maxLevel,
  mouliCost,
  mouliUpgradeCost,
  roomCost,
  roomsInUse,
  stageIndex,
  trainingPlan,
  trainingSeconds,
} from "./economy";
import { cloneState, type GameState } from "./state";

// Intents are what clients send. They apply at state.time: the server advances the state
// to "now" first. They never mutate their input and never throw on bad input from a client.

export type IntentError =
  | "season_over"
  | "insufficient_funds"
  | "locked"
  | "not_found"
  | "busy"
  | "max_level"
  | "no_free_room"
  | "max_rooms"
  | "invalid_value";

export type IntentResult = { ok: true; state: GameState } | { ok: false; error: IntentError };

const fail = (error: IntentError): IntentResult => ({ ok: false, error });

function precheck(state: GameState, cost: number, cfg: Balance): IntentError | null {
  if (state.time >= cfg.seasonSeconds) return "season_over";
  if (state.money < cost) return "insufficient_funds";
  return null;
}

export function hire(state: GameState, kind: HireKind, cfg: Balance = BALANCE): IntentResult {
  const kindCfg = Object.hasOwn(cfg.hire.kinds, kind) ? cfg.hire.kinds[kind] : undefined;
  if (!kindCfg) return fail("invalid_value");
  if (state.tier < kindCfg.tier) return fail("locked");
  const cost = hireCost(state, kind, cfg);
  const error = precheck(state, cost, cfg);
  if (error) return fail(error);

  const s = cloneState(state);
  s.money -= cost;
  s.devs.push({ id: s.nextDevId, kind, level: kindCfg.level, training: null });
  s.nextDevId += 1;
  return { ok: true, state: s };
}

/**
 * Send a dev to training until `targetLevel` (default: next level). All levels are paid upfront.
 * The dev occupies one room for the whole duration, keeps their salary and writes no code.
 */
export function train(
  state: GameState,
  devId: number,
  targetLevel?: number,
  cfg: Balance = BALANCE,
): IntentResult {
  const dev = state.devs.find((d) => d.id === devId);
  if (!dev) return fail("not_found");
  if (isTraining(dev)) return fail("busy");
  if (dev.level >= maxLevel(cfg)) return fail("max_level");
  const target = targetLevel ?? dev.level + 1;
  if (!Number.isInteger(target) || target <= dev.level || target > maxLevel(cfg)) {
    return fail("invalid_value");
  }
  if (roomsInUse(state) >= state.rooms) return fail("no_free_room");
  const { cost } = trainingPlan(dev.level, target, cfg);
  const error = precheck(state, cost, cfg);
  if (error) return fail(error);

  const s = cloneState(state);
  s.money -= cost;
  const trainee = s.devs.find((d) => d.id === devId);
  if (trainee) {
    trainee.training = {
      targetLevel: target,
      levelEndsAt: s.time + trainingSeconds(dev.level, cfg),
    };
  }
  return { ok: true, state: s };
}

export function buyRoom(state: GameState, cfg: Balance = BALANCE): IntentResult {
  if (state.rooms >= cfg.rooms.max) return fail("max_rooms");
  const cost = roomCost(state, cfg);
  const error = precheck(state, cost, cfg);
  if (error) return fail(error);

  const s = cloneState(state);
  s.money -= cost;
  s.rooms += 1;
  return { ok: true, state: s };
}

export function buyMouli(state: GameState, stageId: StageId, cfg: Balance = BALANCE): IntentResult {
  const i = stageIndex(stageId, cfg);
  const stage = cfg.stages[i];
  if (!stage) return fail("not_found");
  if (state.tier < stage.tier) return fail("locked");
  const cost = mouliCost(state, stageId, cfg);
  const error = precheck(state, cost, cfg);
  if (error) return fail(error);

  const s = cloneState(state);
  s.money -= cost;
  const target = s.stages[i];
  if (target) target.instances += 1;
  return { ok: true, state: s };
}

/** Next version of a stage: multiplies the throughput of all its instances. */
export function upgradeMouli(
  state: GameState,
  stageId: StageId,
  cfg: Balance = BALANCE,
): IntentResult {
  const i = stageIndex(stageId, cfg);
  const stage = cfg.stages[i];
  if (!stage) return fail("not_found");
  if (state.tier < stage.tier) return fail("locked");
  const cost = mouliUpgradeCost(state, stageId, cfg);
  const error = precheck(state, cost, cfg);
  if (error) return fail(error);

  const s = cloneState(state);
  s.money -= cost;
  const target = s.stages[i];
  if (target) target.version += 1;
  return { ok: true, state: s };
}

/** Free, can be changed at any time. Applies to the whole stage. */
export function setStrictness(
  state: GameState,
  stageId: StageId,
  level: number,
  cfg: Balance = BALANCE,
): IntentResult {
  const i = stageIndex(stageId, cfg);
  if (!cfg.stages[i]) return fail("not_found");
  if (!Number.isInteger(level) || level < 0 || level >= cfg.strictness.length) {
    return fail("invalid_value");
  }
  const error = precheck(state, 0, cfg);
  if (error) return fail(error);

  const s = cloneState(state);
  const target = s.stages[i];
  if (target) target.strictness = level;
  return { ok: true, state: s };
}

/** French messages for the clients. */
export const INTENT_ERROR_MESSAGES: Readonly<Record<IntentError, string>> = {
  season_over: "La saison est terminée.",
  insufficient_funds: "Pas assez d'argent.",
  locked: "Pas encore débloqué.",
  not_found: "Introuvable.",
  busy: "Ce dev est déjà en formation.",
  max_level: "Ce dev a atteint le niveau maximum.",
  no_free_room: "Aucune salle de formation libre.",
  max_rooms: "Nombre maximum de salles atteint.",
  invalid_value: "Valeur invalide.",
};
