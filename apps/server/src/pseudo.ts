import type { Db } from "./db";

// Pseudo rules on top of the format (PSEUDO_PATTERN): what makes a pseudo the same as another,
// which ones are refused, and how often a player may change theirs.

export const PSEUDO_PATTERN = "^[A-Za-z0-9_-]{3,16}$";

/** After a rename, the next one waits this long. The first choice and one fix right after are free. */
export const RENAME_COOLDOWN_MS = 24 * 3600 * 1000;
/** A pseudo given up stays reserved for its old owner this long: shared links keep pointing to them. */
export const RELEASE_MS = 14 * 24 * 3600 * 1000;

/**
 * Two pseudos with the same key are the same pseudo: case, "_" and "-" are ignored, and the
 * lookalikes 0/o and 1/i/l are merged, so "Mini_lan", "MINILAN" and "MiniIan" collide.
 * The same mapping is written in SQL in migrations.ts: keep both in sync.
 */
export function pseudoKey(pseudo: string): string {
  return pseudo.toLowerCase().replace(/[_-]/g, "").replace(/0/g, "o").replace(/[1i]/g, "l");
}

// Refused pseudos, compared by key. Long words are refused anywhere in the pseudo ("xXconnardXx"),
// short ones only as the whole pseudo, so "Technique" or "Computer" stay possible.
const RESERVED = ["admin", "administrateur", "moderateur", "modo", "staff", "support", "root"];
const BRANDS = ["epitech", "epidle", "officiel", "official", "pedago"];
const INSULTS = [
  "connard",
  "connasse",
  "salope",
  "encule",
  "enculer",
  "putain",
  "batard",
  "bougnoule",
  "tapette",
  "hitler",
  "faggot",
  "nigger",
  "merde",
  "pute",
  "fdp",
  "ntm",
  "pd",
  "pede",
  "nazi",
  "negre",
  "nigga",
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "whore",
  "slut",
  "rape",
  "viol",
  "porn",
  "porno",
  "sex",
  "bite",
];
const CONTAINS_MIN_LENGTH = 6;
const BLOCKED = [...RESERVED, ...BRANDS, ...INSULTS].map(pseudoKey);

export function isPseudoAllowed(pseudo: string): boolean {
  const key = pseudoKey(pseudo);
  return !BLOCKED.some((word) =>
    word.length >= CONTAINS_MIN_LENGTH ? key.includes(word) : key === word,
  );
}

export type PseudoRefusal = "pseudo_taken" | "pseudo_forbidden" | "pseudo_cooldown";

interface UserRow {
  pseudo: string | null;
  changedAt: number | null;
}

/** Why `userId` may not take `pseudo` now, null if they may. `admin` skips the cooldown and the blocklist. */
export function pseudoRefusal(
  db: Db,
  userId: number,
  pseudo: string,
  now: number,
  admin = false,
): PseudoRefusal | null {
  const key = pseudoKey(pseudo);
  const user = db
    .prepare("SELECT pseudo, pseudo_changed_at AS changedAt FROM users WHERE id = ?")
    .get(userId) as UserRow | undefined;
  if (!user) return "pseudo_taken";
  // Same pseudo with another case or "_": always fine, it is still yours.
  if (user.pseudo !== null && pseudoKey(user.pseudo) === key) return null;
  if (!admin && !isPseudoAllowed(pseudo)) return "pseudo_forbidden";
  if (db.prepare("SELECT 1 FROM users WHERE pseudo_key = ? AND id != ?").get(key, userId)) {
    return "pseudo_taken";
  }
  const released = db
    .prepare(
      "SELECT 1 FROM released_pseudos WHERE pseudo_key = ? AND user_id != ? AND released_at > ?",
    )
    .get(key, userId, now - RELEASE_MS);
  if (released) return "pseudo_taken";
  if (
    !admin &&
    user.pseudo !== null &&
    user.changedAt !== null &&
    now - user.changedAt < RENAME_COOLDOWN_MS
  ) {
    return "pseudo_cooldown";
  }
  return null;
}

/** Sets the pseudo, reserving the previous one for its owner. Check pseudoRefusal first. */
export function setPseudo(db: Db, userId: number, pseudo: string, now: number): void {
  db.transaction(() => {
    const user = db.prepare("SELECT pseudo FROM users WHERE id = ?").get(userId) as
      | { pseudo: string | null }
      | undefined;
    const old = user?.pseudo ?? null;
    const sameKey = old !== null && pseudoKey(old) === pseudoKey(pseudo);
    if (old !== null && !sameKey) {
      db.prepare(
        `INSERT INTO released_pseudos (pseudo_key, user_id, released_at) VALUES (?, ?, ?)
         ON CONFLICT (pseudo_key) DO UPDATE SET user_id = excluded.user_id, released_at = excluded.released_at`,
      ).run(pseudoKey(old), userId, now);
    }
    db.prepare("DELETE FROM released_pseudos WHERE pseudo_key = ?").run(pseudoKey(pseudo));
    // Neither the first choice nor a case change starts the cooldown, a real rename does.
    const rename = old !== null && !sameKey;
    db.prepare(
      `UPDATE users SET pseudo = ?, pseudo_key = ?,
         pseudo_changed_at = CASE WHEN ? THEN ? ELSE pseudo_changed_at END WHERE id = ?`,
    ).run(pseudo, pseudoKey(pseudo), rename ? 1 : 0, now, userId);
  })();
}
