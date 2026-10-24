import {
  advanceSeason,
  BALANCE,
  type Balance,
  balanceAt,
  createInitialState,
  type GameState,
  isGameState,
  type SeasonWeeks,
  weekIndex,
} from "@epidle/core";
import type { Db } from "./db";
import { recordProgress, trackRanks } from "./feed";

export interface Season {
  id: number;
  startsAt: number;
  endsAt: number;
  closedAt: number | null;
  scoresRefreshedAt: number;
  /** Weekly modifiers, fixed when the season opens. */
  weeks: SeasonWeeks;
}

/** Season time (seconds since its start) at wall-clock `now` (ms), within [0, season length]. */
export function seasonTime(season: Season, now: number): number {
  return Math.min(Math.max((now - season.startsAt) / 1000, 0), BALANCE.seasonSeconds);
}

/** The balance in force for `state`: the one of its week. Use it for rates and intents. */
export const stateBalance = (season: Season, state: GameState): Balance =>
  balanceAt(season.weeks, state.time);

/** Catches the state up to `now`. The server clock is the only clock: clients never send time. */
export function catchUp(state: GameState, season: Season, now: number): GameState {
  const dt = seasonTime(season, now) - state.time;
  return dt > 0 ? advanceSeason(state, dt, season.weeks) : state;
}

interface GameRow {
  state: string;
  week: number;
  weekBase: number;
}

/** A stored state that cannot be read back: only its own player is affected. */
export class CorruptStateError extends Error {
  constructor(readonly userId: number) {
    super(`corrupted game state for user ${userId}`);
  }
}

/** Parses a stored state, null if it is not valid JSON or not a valid state. */
export function parseState(json: string): GameState | null {
  try {
    const value: unknown = JSON.parse(json);
    return isGameState(value) ? value : null;
  } catch {
    return null;
  }
}

function readState(userId: number, json: string): GameState {
  const state = parseState(json);
  if (!state) throw new CorruptStateError(userId);
  return state;
}

const SELECT_ROW =
  "SELECT state, week, week_base AS weekBase FROM games WHERE user_id = ? AND season_id = ?";

/** The player's company for this season at `now`, created on first visit. Not saved. */
export function loadGame(db: Db, userId: number, season: Season, now: number): GameState {
  const row = db.prepare(SELECT_ROW).get(userId, season.id) as GameRow | undefined;
  if (row) return catchUp(readState(userId, row.state), season, now);
  // Late joiners start at the current season time: the season end is the same for everyone.
  return { ...createInitialState(), time: seasonTime(season, now) };
}

/** Score at the start of the week `state` is in, from the row saved before it. */
function weekBase(
  season: Season,
  prev: GameRow | undefined,
  before: GameState | null,
  state: GameState,
) {
  const week = weekIndex(state.time);
  if (!prev || !before) return 0;
  if (prev.week === week) return prev.weekBase;
  // The previous save is from an earlier week and nothing happened since (every intent saves),
  // so advancing it to the boundary gives the exact score at the start of this week.
  const start = week * BALANCE.weekSeconds;
  if (before.time >= start) return before.revenue;
  return advanceSeason(before, start - before.time, season.weeks).revenue;
}

function writeGame(
  db: Db,
  userId: number,
  season: Season,
  prev: GameRow | undefined,
  before: GameState | null,
  state: GameState,
  now: number,
): void {
  recordProgress(db, season, userId, before, state);
  db.prepare(
    `INSERT INTO games (user_id, season_id, state, score, week, week_base, joined_at)
     VALUES (@userId, @seasonId, @state, @score, @week, @weekBase, @now)
     ON CONFLICT (user_id, season_id) DO UPDATE SET state = excluded.state, score = excluded.score,
       week = excluded.week, week_base = excluded.week_base`,
  ).run({
    userId,
    seasonId: season.id,
    state: JSON.stringify(state),
    score: state.revenue,
    week: weekIndex(state.time),
    weekBase: weekBase(season, prev, before, state),
    now,
  });
}

export function saveGame(db: Db, userId: number, season: Season, state: GameState, now: number) {
  const prev = db.prepare(SELECT_ROW).get(userId, season.id) as GameRow | undefined;
  writeGame(db, userId, season, prev, prev ? readState(userId, prev.state) : null, state, now);
}

/**
 * Advances every company of the season to `now` so leaderboard scores are live. A corrupted row
 * is left as is (its score frozen) instead of failing the leaderboard and the season rollover for
 * everyone. Returns the user ids of those rows, for the log.
 */
export function refreshScores(db: Db, season: Season, now: number): number[] {
  const rows = db
    .prepare(
      "SELECT user_id AS userId, state, week, week_base AS weekBase FROM games WHERE season_id = ?",
    )
    .all(season.id) as (GameRow & { userId: number })[];
  const corrupted: number[] = [];
  db.transaction(() => {
    for (const row of rows) {
      const before = parseState(row.state);
      if (!before) {
        corrupted.push(row.userId);
        continue;
      }
      writeGame(db, row.userId, season, row, before, catchUp(before, season, now), now);
    }
    trackRanks(db, season, now);
    db.prepare("UPDATE seasons SET scores_refreshed_at = ? WHERE id = ?").run(now, season.id);
  })();
  return corrupted;
}
