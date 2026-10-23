import { HOUR } from "@epidle/core";
import type { Db } from "./db";

// Signs that someone plays with a script rather than a client. Nothing is blocked automatically
// (a false positive would ban a student for playing a lot): rows are logged for a human to review
// with `pnpm admin suspicious`. Rate limits do the actual blocking.

export type SuspiciousKind =
  /** Hit a rate limit: the official clients stay far below them. */
  | "rate_limited"
  /** An intent the schema refused: the official clients never send one. */
  | "invalid_intent"
  /** A reused requestId: the official clients draw a new one per action and never retry. */
  | "replay"
  /** More intents in an hour than anyone clicks. */
  | "intent_flood"
  /** Intents in at least 20 different hours out of the last 24. */
  | "no_sleep"
  /** Intents at a near-constant interval, like a timer. */
  | "robotic_cadence";

export interface Suspicion {
  userId: number | null;
  ip: string | null;
  kind: SuspiciousKind;
  detail?: string;
}

/** Same player (or IP when anonymous) and kind are logged at most once per window. */
const DEDUPE_MS = 10 * 60 * 1000;
export const FLOOD_INTENTS_PER_HOUR = 1000;
export const NO_SLEEP_HOURS = 20;
const CADENCE_MIN_INTENTS = 60;
/** Standard deviation / mean of the intervals between intents, below which it looks like a timer. */
const CADENCE_MAX_VARIATION = 0.1;

/** Logs a suspicion unless the same one was logged recently. Returns whether it was logged. */
export function flagSuspicious(db: Db, s: Suspicion, now: number): boolean {
  const seen = db
    .prepare(
      `SELECT 1 FROM suspicious WHERE kind = ? AND at > ?
       AND (user_id = ? OR (? IS NULL AND user_id IS NULL AND ip = ?))`,
    )
    .get(s.kind, now - DEDUPE_MS, s.userId, s.userId, s.ip);
  if (seen) return false;
  db.prepare(
    `INSERT INTO suspicious (at, user_id, pseudo, ip, kind, detail)
     VALUES (?, ?, (SELECT pseudo FROM users WHERE id = ?), ?, ?, ?)`,
  ).run(now, s.userId, s.userId, s.ip, s.kind, s.detail ?? "");
  return true;
}

function variation(times: number[]): number {
  const gaps = times.slice(1).map((t, i) => t - (times[i] ?? t));
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean <= 0) return 0;
  const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
  return Math.sqrt(variance) / mean;
}

/** Looks for scripted patterns in the intents of the last 24 h (kept for replay detection). */
export function scanActivity(db: Db, now: number): Suspicion[] {
  const hourMs = HOUR * 1000;
  const found: Suspicion[] = [];
  const busy = db
    .prepare(
      "SELECT user_id AS userId, count(*) AS n FROM intent_requests WHERE created_at > ? GROUP BY user_id",
    )
    .all(now - hourMs) as { userId: number; n: number }[];
  for (const { userId, n } of busy) {
    if (n > FLOOD_INTENTS_PER_HOUR) {
      found.push({ userId, ip: null, kind: "intent_flood", detail: `${n} intents en 1 h` });
    }
    if (n >= CADENCE_MIN_INTENTS) {
      const times = (
        db
          .prepare(
            "SELECT created_at AS t FROM intent_requests WHERE user_id = ? AND created_at > ? ORDER BY t",
          )
          .all(userId, now - hourMs) as { t: number }[]
      ).map((r) => r.t);
      const v = variation(times);
      if (v < CADENCE_MAX_VARIATION) {
        found.push({
          userId,
          ip: null,
          kind: "robotic_cadence",
          detail: `${n} intents en 1 h, écart relatif ${v.toFixed(3)}`,
        });
      }
    }
  }
  const sleepless = db
    .prepare(
      `SELECT user_id AS userId, count(DISTINCT created_at / ${hourMs}) AS hours FROM intent_requests
       WHERE created_at > ? GROUP BY user_id HAVING hours >= ${NO_SLEEP_HOURS}`,
    )
    .all(now - 24 * hourMs) as { userId: number; hours: number }[];
  for (const { userId, hours } of sleepless) {
    found.push({ userId, ip: null, kind: "no_sleep", detail: `actif ${hours} h sur 24` });
  }
  for (const s of found) flagSuspicious(db, s, now);
  return found;
}
