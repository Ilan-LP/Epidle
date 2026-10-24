import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdmin } from "./admin";
import { openDb } from "./db";
import { migrate } from "./migrations";
import { isPseudoAllowed, pseudoKey, RELEASE_MS, RENAME_COOLDOWN_MS } from "./pseudo";
import { MS, testApp } from "./test-utils";

let t: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => t.app.close());

const put = (token: string, pseudo: string) =>
  t.app.inject({
    method: "PUT",
    url: "/api/me/pseudo",
    headers: t.auth(token),
    payload: { pseudo },
  });

describe("pseudoKey and the blocklist", () => {
  it("merges case, separators and lookalikes", () => {
    for (const p of ["MINILAN", "Mini_lan", "mini-lan", "MiniIan", "Mini1an"]) {
      expect(pseudoKey(p), p).toBe(pseudoKey("Minilan"));
    }
    expect(pseudoKey("B0b")).toBe(pseudoKey("bob"));
  });

  it("refuses reserved names and insults, even disguised, but not innocent words", () => {
    for (const bad of [
      "admin",
      "Epitech",
      "EPIDLE_off",
      "xXc0nnardXx",
      "Sal0pe",
      "fdp",
      "Hitler42",
    ]) {
      expect(isPseudoAllowed(bad), bad).toBe(false);
    }
    for (const ok of ["Technique", "Computer", "Unique", "Violette", "Minilan", "Bite_Code"]) {
      expect(isPseudoAllowed(ok), ok).toBe(true);
    }
  });
});

describe("PUT /api/me/pseudo", () => {
  it("refuses a lookalike of a taken pseudo", async () => {
    t.player("oid-a", "Minilan");
    const b = await t.login("oid-b");
    for (const lookalike of ["MiniIan", "mini_lan", "M1nilan"]) {
      expect((await put(b, lookalike)).json().error, lookalike).toBe("pseudo_taken");
    }
  });

  it("refuses forbidden pseudos with a message", async () => {
    const a = await t.login("oid-a");
    const res = await put(a, "Connard_du_93");
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: "pseudo_forbidden", message: expect.any(String) });
  });

  it("allows the first choice and one fix, then one rename per 24 h", async () => {
    const a = await t.login("oid-a");
    expect((await put(a, "Alise")).statusCode).toBe(200);
    expect((await put(a, "Alice")).statusCode).toBe(200); // typo fix right after choosing
    expect((await put(a, "Alicia")).json().error).toBe("pseudo_cooldown");
    expect((await put(a, "ALICE")).statusCode).toBe(200); // a case change is not a rename
    t.clock.t += RENAME_COOLDOWN_MS + MS;
    expect((await put(a, "Alicia")).statusCode).toBe(200);
  });

  it("keeps a given up pseudo for its owner for 14 days", async () => {
    const a = t.player("oid-a", "Alice");
    const b = t.player("oid-b", "Bobby");
    expect((await put(a, "Alice2")).statusCode).toBe(200);
    expect((await put(b, "alice")).json().error).toBe("pseudo_taken");
    t.clock.t += RELEASE_MS + MS;
    expect((await put(b, "alice")).statusCode).toBe(200);
  });

  it("lets the owner take back their old pseudo", async () => {
    const a = t.player("oid-a", "Alice");
    await put(a, "Alice2");
    t.clock.t += RENAME_COOLDOWN_MS + MS;
    expect((await put(a, "Alice")).statusCode).toBe(200);
  });
});

describe("admin rename", () => {
  it("renames without cooldown or blocklist checks, but never onto a taken pseudo", async () => {
    t.player("oid-a", "Insulte");
    t.player("oid-b", "Bobby");
    const lines: string[] = [];
    const run = (argv: string[]) =>
      runAdmin(argv, {
        db: t.db,
        now: t.clock.t,
        rotation: [],
        backup: null,
        out: (l) => lines.push(l),
      });
    expect(await run(["rename", "Insulte", "Joueur42"])).toBe(0);
    expect(await run(["rename", "Joueur42", "bobby"])).toBe(1);
    expect(await run(["rename", "Joueur42", "not valid"])).toBe(2);
    expect(t.db.prepare("SELECT pseudo FROM users ORDER BY id").all()).toEqual([
      { pseudo: "Joueur42" },
      { pseudo: "Bobby" },
    ]);
  });
});

describe("migration", () => {
  it("fills the key of existing pseudos with the same mapping as pseudoKey", () => {
    const db = openDb(":memory:");
    // Back to just before the pseudo rules (migration 3), dropping what it and later ones add.
    db.pragma("user_version = 2");
    db.exec("DROP TABLE awards; DROP TABLE released_pseudos; DROP INDEX users_pseudo_key;");
    db.exec(
      "ALTER TABLE users DROP COLUMN pseudo_key; ALTER TABLE users DROP COLUMN pseudo_changed_at;",
    );
    const pseudos = ["Mini_Lan", "B0b-1", "Ivy", "x_X-0i1lI"];
    pseudos.forEach((p, i) => {
      db.prepare("INSERT INTO users (ms_oid, pseudo, created_at) VALUES (?, ?, 0)").run(`o${i}`, p);
    });
    migrate(db);
    expect(db.prepare("SELECT pseudo, pseudo_key AS key FROM users ORDER BY id").all()).toEqual(
      pseudos.map((p) => ({ pseudo: p, key: pseudoKey(p) })),
    );
  });
});
