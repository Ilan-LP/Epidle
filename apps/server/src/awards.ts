import { BALANCE, maxLevel } from "@epidle/core";
import type { Db } from "./db";
import { parseState, type Season } from "./games";

// Badges: what a player keeps from a season when everything else resets. Written once, when the
// season closes. A title is the best badge a player ever got, shown next to their pseudo.

export type AwardKind = "rank" | "legende" | "licorne";

export interface Award {
  seasonId: number;
  kind: AwardKind;
  /** Final rank for "rank" (1-10), 0 otherwise. */
  value: number;
}

const TOP = 10;
const LAST_TIER = BALANCE.tiers.length - 1;

/** Awards of a season that just closed: top 10, a Légende dev, the last tier. Idempotent. */
export function grantAwards(db: Db, season: Season): void {
  const insert = db.prepare(
    `INSERT INTO awards (user_id, season_id, kind, value) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, season_id, kind) DO NOTHING`,
  );
  const ranked = db
    .prepare(
      `SELECT user_id AS userId, rank FROM (
         SELECT g.user_id, RANK() OVER (ORDER BY g.score DESC) AS rank FROM games g
         JOIN users u ON u.id = g.user_id WHERE g.season_id = ? AND u.pseudo IS NOT NULL AND g.score > 0
       ) WHERE rank <= ${TOP}`,
    )
    .all(season.id) as { userId: number; rank: number }[];
  for (const { userId, rank } of ranked) insert.run(userId, season.id, "rank", rank);

  const rows = db
    .prepare("SELECT user_id AS userId, state FROM games WHERE season_id = ?")
    .all(season.id) as { userId: number; state: string }[];
  for (const row of rows) {
    const state = parseState(row.state);
    if (!state) continue;
    if (state.devs.some((d) => d.level >= maxLevel())) {
      insert.run(row.userId, season.id, "legende", 0);
    }
    if (state.tier >= LAST_TIER) insert.run(row.userId, season.id, "licorne", 0);
  }
}

/** Higher is better: champion, then a Légende dev, the podium, the last tier, the top 10. */
export function awardWeight(a: Award): number {
  if (a.kind === "rank") return a.value === 1 ? 100 : a.value <= 3 ? 70 - a.value : 20 - a.value;
  return a.kind === "legende" ? 80 : 30;
}

/** Every award of a player, newest season first. */
export function awardsOf(db: Db, userId: number): Award[] {
  return db
    .prepare(
      `SELECT season_id AS seasonId, kind, value FROM awards WHERE user_id = ?
       ORDER BY season_id DESC, kind`,
    )
    .all(userId) as Award[];
}

/** The best award of each player: their title. Ties go to the most recent season. */
export function titlesOf(db: Db, userIds: number[]): Map<number, Award> {
  const titles = new Map<number, Award>();
  if (userIds.length === 0) return titles;
  const rows = db
    .prepare(
      `SELECT user_id AS userId, season_id AS seasonId, kind, value FROM awards
       WHERE user_id IN (${userIds.map(() => "?").join(",")}) ORDER BY season_id DESC`,
    )
    .all(...userIds) as (Award & { userId: number })[];
  for (const { userId, ...award } of rows) {
    const best = titles.get(userId);
    if (!best || awardWeight(award) > awardWeight(best)) titles.set(userId, award);
  }
  return titles;
}
