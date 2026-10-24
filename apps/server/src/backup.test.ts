import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";
import { backupName, backupRotate } from "./backup";
import { openDb } from "./db";

describe("backups", () => {
  const dir = mkdtempSync(join(tmpdir(), "epidle-backup-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("names backups by UTC date so they sort by name", () => {
    expect(backupName(Date.UTC(2026, 9, 23, 14, 30, 5))).toBe("epidle-20261023-143005.db");
  });

  it("writes a consistent copy of a live database and keeps the newest ones", async () => {
    const db = openDb(join(dir, "live.db"));
    db.prepare("INSERT INTO users (ms_oid, created_at) VALUES ('x', 0)").run();
    const out = join(dir, "backups");
    let last = "";
    for (let i = 0; i < 4; i++) last = await backupRotate(db, out, 2, Date.UTC(2026, 9, 23, i));
    expect(readdirSync(out).sort()).toEqual([
      "epidle-20261023-020000.db",
      "epidle-20261023-030000.db",
    ]);
    db.close();
    const copy = new Database(last, { readonly: true });
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(copy.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 1 });
    copy.close();
  });

  it.skipIf(process.platform === "win32")(
    "keeps the database and its backups owner only",
    async () => {
      const live = join(dir, "perms.db");
      const db = openDb(live);
      db.prepare("INSERT INTO users (ms_oid, created_at) VALUES ('y', 0)").run();
      const file = await backupRotate(db, join(dir, "perms-backups"), 3, Date.UTC(2026, 9, 24));
      const mode = (f: string) => statSync(f).mode & 0o777;
      expect(mode(live)).toBe(0o600);
      expect(mode(`${live}-wal`)).toBe(0o600);
      expect(mode(file)).toBe(0o600);
      db.close();
    },
  );
});
