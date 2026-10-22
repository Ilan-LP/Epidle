import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "./db";
import { MIGRATIONS, migrate } from "./migrations";

describe("migrations", () => {
  const dir = mkdtempSync(join(tmpdir(), "epidle-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("bring a new database to the latest version and keep data on reopen", () => {
    const path = join(dir, "a.db");
    const db = openDb(path);
    expect(db.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    db.prepare("INSERT INTO users (ms_oid, created_at) VALUES ('x', 0)").run();
    db.close();
    const again = openDb(path);
    expect(again.prepare("SELECT count(*) AS n FROM users").get()).toEqual({ n: 1 });
    again.close();
  });

  it("refuse a database written by a newer server", () => {
    const db = openDb(":memory:");
    db.pragma(`user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(db)).toThrow(/newer|only knows/);
  });
});
