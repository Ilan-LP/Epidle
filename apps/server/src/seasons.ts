import { BALANCE } from "@epidle/core";
import type { Db } from "./db";
import { refreshScores, type Season } from "./games";

const SEASON_MS = BALANCE.seasonSeconds * 1000;
/** How long processed intent request ids are kept to detect replays. */
const REQUEST_ID_TTL_MS = 24 * 3600 * 1000;

const SELECT_SEASON = `SELECT id, starts_at AS startsAt, ends_at AS endsAt, closed_at AS closedAt,
  scores_refreshed_at AS scoresRefreshedAt FROM seasons`;

function latestSeason(db: Db): Season | null {
  return (db.prepare(`${SELECT_SEASON} ORDER BY id DESC LIMIT 1`).get() as Season) ?? null;
}

export function getSeason(db: Db, id: number): Season | null {
  return (db.prepare(`${SELECT_SEASON} WHERE id = ?`).get(id) as Season) ?? null;
}

function openSeason(db: Db, startsAt: number): Season {
  const { lastInsertRowid } = db
    .prepare("INSERT INTO seasons (starts_at, ends_at) VALUES (?, ?)")
    .run(startsAt, startsAt + SEASON_MS);
  return getSeason(db, Number(lastInsertRowid)) as Season;
}

/** Freezes every company at the season end: their final score is their revenue at that time. */
function closeSeason(db: Db, season: Season, now: number): void {
  db.transaction(() => {
    refreshScores(db, season, season.endsAt);
    db.prepare("UPDATE seasons SET closed_at = ? WHERE id = ?").run(now, season.id);
  })();
}

/**
 * The season running at `now`, closing finished ones and opening the next if needed.
 * Called on every request and by the periodic job, so a rollover never depends on the timer.
 */
export function currentSeason(db: Db, now: number): Season {
  let season = latestSeason(db);
  if (!season) return openSeason(db, now);
  while (now >= season.endsAt) {
    if (season.closedAt === null) closeSeason(db, season, now);
    // Seasons follow each other with no gap. If the server was down for a whole season,
    // the next one starts now instead of creating empty seasons.
    const next = now < season.endsAt + SEASON_MS ? season.endsAt : now;
    season = openSeason(db, next);
  }
  return season;
}

/** Periodic job: season rollover, live scores, cleanup of expired rows. */
export function runMaintenance(db: Db, now: number): void {
  const season = currentSeason(db, now);
  refreshScores(db, season, now);
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db.prepare("DELETE FROM auth_requests WHERE expires_at <= ?").run(now);
  db.prepare("DELETE FROM intent_requests WHERE created_at <= ?").run(now - REQUEST_ID_TTL_MS);
}
