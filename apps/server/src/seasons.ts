import { BALANCE } from "@epidle/core";
import type { Db } from "./db";
import { refreshScores, type Season } from "./games";
import { NO_MODIFIERS, type Rotation, seasonWeeks } from "./modifiers";

const SEASON_MS = BALANCE.seasonSeconds * 1000;
/** How long processed intent request ids are kept to detect replays. */
const REQUEST_ID_TTL_MS = 24 * 3600 * 1000;

const SELECT_SEASON = `SELECT id, starts_at AS startsAt, ends_at AS endsAt, closed_at AS closedAt,
  scores_refreshed_at AS scoresRefreshedAt, weeks FROM seasons`;

type SeasonRow = Omit<Season, "weeks"> & { weeks: string };

const toSeason = (row: SeasonRow | undefined): Season | null =>
  row ? { ...row, weeks: JSON.parse(row.weeks) } : null;

function latestSeason(db: Db): Season | null {
  return toSeason(db.prepare(`${SELECT_SEASON} ORDER BY id DESC LIMIT 1`).get() as SeasonRow);
}

export function getSeason(db: Db, id: number): Season | null {
  return toSeason(db.prepare(`${SELECT_SEASON} WHERE id = ?`).get(id) as SeasonRow);
}

function openSeason(db: Db, startsAt: number, rotation: Rotation): Season {
  return db.transaction(() => {
    const id = Number(
      db
        .prepare("INSERT INTO seasons (starts_at, ends_at) VALUES (?, ?)")
        .run(startsAt, startsAt + SEASON_MS).lastInsertRowid,
    );
    // The weeks are copied: editing the config file never changes a running season.
    db.prepare("UPDATE seasons SET weeks = ? WHERE id = ?").run(
      JSON.stringify(seasonWeeks(rotation, id)),
      id,
    );
    return getSeason(db, id) as Season;
  })();
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
export function currentSeason(db: Db, now: number, rotation: Rotation = NO_MODIFIERS): Season {
  let season = latestSeason(db);
  if (!season) return openSeason(db, now, rotation);
  while (now >= season.endsAt) {
    if (season.closedAt === null) closeSeason(db, season, now);
    // Seasons follow each other with no gap. If the server was down for a whole season,
    // the next one starts now instead of creating empty seasons.
    const next = now < season.endsAt + SEASON_MS ? season.endsAt : now;
    season = openSeason(db, next, rotation);
  }
  return season;
}

/** Periodic job: season rollover, live scores, cleanup of expired rows. */
export function runMaintenance(db: Db, now: number, rotation: Rotation = NO_MODIFIERS): void {
  const season = currentSeason(db, now, rotation);
  refreshScores(db, season, now);
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db.prepare("DELETE FROM auth_requests WHERE expires_at <= ?").run(now);
  db.prepare("DELETE FROM intent_requests WHERE created_at <= ?").run(now - REQUEST_ID_TTL_MS);
}
