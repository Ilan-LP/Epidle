import { advance, BALANCE, createInitialState, type GameState } from "@epidle/core";
import type { Db } from "./db";

export interface Season {
  id: number;
  startsAt: number;
  endsAt: number;
  closedAt: number | null;
  scoresRefreshedAt: number;
}

/** Season time (seconds since its start) at wall-clock `now` (ms), within [0, season length]. */
export function seasonTime(season: Season, now: number): number {
  return Math.min(Math.max((now - season.startsAt) / 1000, 0), BALANCE.seasonSeconds);
}

/** Catches the state up to `now`. The server clock is the only clock: clients never send time. */
export function catchUp(state: GameState, season: Season, now: number): GameState {
  const dt = seasonTime(season, now) - state.time;
  return dt > 0 ? advance(state, dt) : state;
}

/** The player's company for this season at `now`, created on first visit. Not saved. */
export function loadGame(db: Db, userId: number, season: Season, now: number): GameState {
  const row = db
    .prepare("SELECT state FROM games WHERE user_id = ? AND season_id = ?")
    .get(userId, season.id) as { state: string } | undefined;
  if (row) return catchUp(JSON.parse(row.state) as GameState, season, now);
  // Late joiners start at the current season time: the season end is the same for everyone.
  return { ...createInitialState(), time: seasonTime(season, now) };
}

export function saveGame(db: Db, userId: number, seasonId: number, state: GameState): void {
  db.prepare(
    `INSERT INTO games (user_id, season_id, state, score) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, season_id) DO UPDATE SET state = excluded.state, score = excluded.score`,
  ).run(userId, seasonId, JSON.stringify(state), state.revenue);
}

/** Advances every company of the season to `now` so leaderboard scores are live. */
export function refreshScores(db: Db, season: Season, now: number): void {
  const rows = db
    .prepare("SELECT user_id, state FROM games WHERE season_id = ?")
    .all(season.id) as {
    user_id: number;
    state: string;
  }[];
  db.transaction(() => {
    for (const row of rows) {
      const state = catchUp(JSON.parse(row.state) as GameState, season, now);
      saveGame(db, row.user_id, season.id, state);
    }
    db.prepare("UPDATE seasons SET scores_refreshed_at = ? WHERE id = ?").run(now, season.id);
  })();
}
