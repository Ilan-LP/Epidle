import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db";

// Anti-bot "Mouli Check": native terminal ASCII-art verification challenge.
// Requires human interaction without leaving the terminal or opening a browser.

export const CHALLENGE_EXPIRES_MS = 120_000; // 2 minutes to solve
export const VERIFIED_DURATION_MS = 4 * 3600_000; // 4 hours before next periodic check
export const INITIAL_GRACE_PERIOD_MS = 3 * 3600_000; // 3 hours for new accounts
export const MAX_ATTEMPTS = 3;

/** Charset excluding visually ambiguous characters (no 0/O, no 1/I/l). */
export const CHAR_SET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** 4-row glyphs from the figlet font DiamFont (patorjk.com/software/taag). Widths vary; rows of one glyph must match. */
export const GLYPHS: Record<string, [string, string, string, string]> = {
  "2": ["▄▄▄▄", "   █", "█▀▀▀", "█▄▄▄"],
  "3": ["▄▄▄▄", "   █", "▀▀▀█", "▄▄▄█"],
  "4": ["▄  ▗▖", "█  ▐▌", "▀▀▀▜▌", "   ▐▌"],
  "5": ["▄▄▄▄", "█   ", "▀▀▀█", "▄▄▄█"],
  "6": ["▄▄▄▄", "█   ", "█▀▀█", "█▄▄█"],
  "7": ["▗▄▄▄▖", "   ▐▌", "   ▐▌", "   ▐▌"],
  "8": ["▄▄▄▄", "█  █", "█▀▀█", "█▄▄█"],
  "9": ["▄▄▄▄", "█  █", "▀▀▀█", "▄▄▄█"],
  A: [" ▗▄▖ ", "▐▌ ▐▌", "▐▛▀▜▌", "▐▌ ▐▌"],
  B: ["▗▄▄▖ ", "▐▌ ▐▌", "▐▛▀▚▖", "▐▙▄▞▘"],
  C: [" ▗▄▄▖", "▐▌   ", "▐▌   ", "▝▚▄▄▖"],
  D: ["▗▄▄▄ ", "▐▌  █", "▐▌  █", "▐▙▄▄▀"],
  E: ["▗▄▄▄▖", "▐▌   ", "▐▛▀▀▘", "▐▙▄▄▖"],
  F: ["▗▄▄▄▖", "▐▌   ", "▐▛▀▀▘", "▐▌   "],
  G: [" ▗▄▄▖", "▐▌   ", "▐▌▝▜▌", "▝▚▄▞▘"],
  H: ["▗▖ ▗▖", "▐▌ ▐▌", "▐▛▀▜▌", "▐▌ ▐▌"],
  J: ["   ▗▖", "   ▐▌", "   ▐▌", "▗▄▄▞▘"],
  K: ["▗▖ ▗▖", "▐▌▗▞▘", "▐▛▚▖ ", "▐▌ ▐▌"],
  L: ["▗▖   ", "▐▌   ", "▐▌   ", "▐▙▄▄▖"],
  M: ["▗▖  ▗▖", "▐▛▚▞▜▌", "▐▌  ▐▌", "▐▌  ▐▌"],
  N: ["▗▖  ▗▖", "▐▛▚▖▐▌", "▐▌ ▝▜▌", "▐▌  ▐▌"],
  P: ["▗▄▄▖ ", "▐▌ ▐▌", "▐▛▀▘ ", "▐▌   "],
  Q: ["▗▄▄▄▖ ", "▐▌ ▐▌ ", "▐▌ ▐▌ ", "▐▙▄▟▙▖"],
  R: ["▗▄▄▖ ", "▐▌ ▐▌", "▐▛▀▚▖", "▐▌ ▐▌"],
  S: [" ▗▄▄▖", "▐▌   ", " ▝▀▚▖", "▗▄▄▞▘"],
  T: ["▗▄▄▄▖", "  █  ", "  █  ", "  █  "],
  U: ["▗▖ ▗▖", "▐▌ ▐▌", "▐▌ ▐▌", "▝▚▄▞▘"],
  V: ["▗▖  ▗▖", "▐▌  ▐▌", "▐▌  ▐▌", " ▝▚▞▘ "],
  W: ["▗▖ ▗▖", "▐▌ ▐▌", "▐▌ ▐▌", "▐▙█▟▌"],
  X: ["▗▖  ▗▖", " ▝▚▞▘ ", "  ▐▌  ", "▗▞▘▝▚▖"],
  Y: ["▗▖  ▗▖", " ▝▚▞▘ ", "  ▐▌  ", "  ▐▌  "],
  Z: ["▗▄▄▄▄▖", "   ▗▞▘", " ▗▞▘  ", "▐▙▄▄▄▖"],
};

/** Converts a text string (e.g. "7K4B") into 4 ASCII-art lines separated by spaces. */
export function renderAscii(text: string): string[] {
  const upper = text.toUpperCase();
  const rows: [string, string, string, string] = ["", "", "", ""];
  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i] ?? "";
    const glyph = GLYPHS[ch] ?? ["????", "????", "????", "????"];
    const sep = i === 0 ? "" : "  ";
    for (let r = 0; r < 4; r++) {
      rows[r] += `${sep}${glyph[r]}`;
    }
  }
  return rows;
}

export interface MouliChallengePayload {
  id: string;
  ascii: string[];
  expiresIn: number;
}

const hashAnswer = (challengeId: string, answer: string) =>
  createHash("sha256").update(`${challengeId}:${answer.trim().toUpperCase()}`).digest("hex");

/** Generates a 4-character random code from CHAR_SET. */
export function randomCode(length = 4): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CHAR_SET[(bytes[i] ?? 0) % CHAR_SET.length];
  }
  return code;
}

/**
 * Checks whether a player is required to pass a Mouli Check before continuing.
 */
export function isMouliCheckRequired(db: Db, userId: number, now: number): boolean {
  const row = db
    .prepare("SELECT verified_until, flagged FROM mouli_status WHERE user_id = ?")
    .get(userId) as { verified_until: number; flagged: number } | undefined;
  if (!row) return false;
  if (row.flagged === 1) return true;
  // If the player has a set expiration that has passed, a check is needed
  if (row.verified_until > 0 && now > row.verified_until) return true;
  return false;
}

/** Marks a user as flagged for an immediate Mouli Check. */
export function flagMouliCheck(db: Db, userId: number): void {
  db.prepare(
    `INSERT INTO mouli_status (user_id, flagged) VALUES (?, 1)
     ON CONFLICT(user_id) DO UPDATE SET flagged = 1`,
  ).run(userId);
}

/**
 * Creates or returns the active Mouli Challenge for a user.
 */
export function getOrCreateChallenge(db: Db, userId: number, now: number): MouliChallengePayload {
  // Check if an unexpired challenge already exists
  const existing = db
    .prepare("SELECT id, expires_at FROM mouli_challenges WHERE user_id = ? AND expires_at > ?")
    .get(userId, now) as { id: string; expires_at: number } | undefined;

  if (existing) {
    const row = db.prepare("SELECT raw_code FROM mouli_challenges WHERE id = ?").get(existing.id) as
      | { raw_code: string }
      | undefined;
    if (row?.raw_code) {
      return {
        id: existing.id,
        ascii: renderAscii(row.raw_code),
        expiresIn: Math.max(1, Math.round((existing.expires_at - now) / 1000)),
      };
    }
  }

  // Delete expired/previous challenges for this user
  db.prepare("DELETE FROM mouli_challenges WHERE user_id = ?").run(userId);

  const id = randomBytes(16).toString("hex");
  const code = randomCode(4);
  const expiresAt = now + CHALLENGE_EXPIRES_MS;
  const answerHash = hashAnswer(id, code);

  db.prepare(
    `INSERT INTO mouli_challenges (id, user_id, answer_hash, raw_code, attempts, expires_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(id, userId, answerHash, code, expiresAt);

  return {
    id,
    ascii: renderAscii(code),
    expiresIn: Math.round(CHALLENGE_EXPIRES_MS / 1000),
  };
}

export type SolveResult =
  | { ok: true }
  | { ok: false; error: "expired" | "not_found" }
  | { ok: false; error: "invalid_code"; remainingAttempts: number }
  | { ok: false; error: "too_many_attempts" };

/**
 * Solves a Mouli Challenge. On success, extends verification for 4 hours and unflags the user.
 */
export function solveChallenge(
  db: Db,
  userId: number,
  challengeId: string,
  answer: string,
  now: number,
): SolveResult {
  const row = db
    .prepare(
      "SELECT answer_hash, attempts, expires_at FROM mouli_challenges WHERE id = ? AND user_id = ?",
    )
    .get(challengeId, userId) as
    | { answer_hash: string; attempts: number; expires_at: number }
    | undefined;

  if (!row) return { ok: false, error: "not_found" };
  if (row.expires_at <= now) {
    db.prepare("DELETE FROM mouli_challenges WHERE id = ?").run(challengeId);
    return { ok: false, error: "expired" };
  }

  const expected = row.answer_hash;
  const actual = hashAnswer(challengeId, answer);

  if (actual === expected) {
    // Challenge passed!
    db.transaction(() => {
      db.prepare("DELETE FROM mouli_challenges WHERE user_id = ?").run(userId);
      db.prepare(
        `INSERT INTO mouli_status (user_id, verified_until, flagged) VALUES (?, ?, 0)
         ON CONFLICT(user_id) DO UPDATE SET verified_until = excluded.verified_until, flagged = 0`,
      ).run(userId, now + VERIFIED_DURATION_MS);
    })();
    return { ok: true };
  }

  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    // Too many failed attempts: burn the challenge so a new one must be requested
    db.prepare("DELETE FROM mouli_challenges WHERE id = ?").run(challengeId);
    return { ok: false, error: "too_many_attempts" };
  }

  db.prepare("UPDATE mouli_challenges SET attempts = ? WHERE id = ?").run(attempts, challengeId);
  return { ok: false, error: "invalid_code", remainingAttempts: MAX_ATTEMPTS - attempts };
}
