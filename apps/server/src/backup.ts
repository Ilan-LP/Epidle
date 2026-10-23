import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db";

// Online SQLite backups with the backup API of better-sqlite3: consistent while the server
// keeps writing, unlike copying the file (the WAL may hold the latest transactions).

const PREFIX = "epidle-";
const SUFFIX = ".db";

/** epidle-20261023-143000.db, in UTC: sorts by name = sorts by date. */
export function backupName(now: number): string {
  const iso = new Date(now).toISOString(); // 2026-10-23T14:30:00.000Z
  return `${PREFIX}${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}${SUFFIX}`;
}

/** Writes a backup to `file`. */
export async function backupTo(db: Db, file: string): Promise<void> {
  await db.backup(file);
}

/** Writes a timestamped backup in `dir` and deletes the oldest ones beyond `keep`. Returns the file. */
export async function backupRotate(
  db: Db,
  dir: string,
  keep: number,
  now: number,
): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, backupName(now));
  await backupTo(db, file);
  const old = readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
    .sort()
    .slice(0, -keep);
  for (const f of old) rmSync(join(dir, f), { force: true });
  return file;
}
