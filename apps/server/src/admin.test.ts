import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runAdmin } from "./admin";
import { MS, testApp } from "./test-utils";

async function setup() {
  const t = await testApp();
  const lines: string[] = [];
  const admin = async (...argv: string[]) => {
    lines.length = 0;
    const code = await runAdmin(argv, {
      db: t.db,
      now: t.clock.t,
      rotation: [],
      backup: null,
      out: (l) => lines.push(l),
    });
    return { code, text: lines.join("\n") };
  };
  return { t, admin };
}

describe("admin", () => {
  const dir = mkdtempSync(join(tmpdir(), "epidle-admin-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("lists players with their season score", async () => {
    const { t, admin } = await setup();
    await t.get(t.player("oid-a", "Alice"), "/api/state");
    t.player("oid-b", "Bob");
    const { code, text } = await admin("players");
    expect(code).toBe(0);
    expect(text).toMatch(/^id\s+pseudo\s+score\s+suspicious\s+created/);
    expect(text).toContain("Alice");
    expect((await admin("players", "bo")).text).not.toContain("Alice");
  });

  it("removes a player only with --yes, and everything that was theirs", async () => {
    const { t, admin } = await setup();
    const alice = t.player("oid-a", "Alice");
    const bob = t.player("oid-b", "Bob");
    await t.get(alice, "/api/state");
    await t.get(bob, "/api/state");

    const dry = await admin("--", "remove", "alice");
    expect(dry.text).toContain("Would remove Alice: 1 season(s), 1 session(s)");
    expect((await t.get(alice, "/api/state")).statusCode).toBe(200);

    expect((await admin("remove", "Alice", "--yes")).text).toContain("Removed Alice");
    expect((await t.get(alice, "/api/state")).statusCode).toBe(401);
    t.clock.t += 31 * MS;
    const board = (await t.get(bob, "/api/leaderboard")).json();
    expect(board.entries.map((e: { pseudo: string }) => e.pseudo)).toEqual(["Bob"]);
    // Not banned: the same Microsoft account can come back as a new player.
    expect(await t.login("oid-a")).toEqual(expect.any(String));
    expect((await admin("remove", "Nobody", "--yes")).code).toBe(1);
  });

  it("bans a removed player until unbanned", async () => {
    const { t, admin } = await setup();
    t.player("oid-a", "Alice");
    await admin("remove", "Alice", "--ban", "--reason", "script", "--yes");
    const start = await t.app.inject({ method: "POST", url: "/api/auth/device" });
    const { handle, userCode } = start.json();
    t.fake.approve(userCode, "oid-a");
    const res = await t.app.inject({
      method: "POST",
      url: "/api/auth/device/token",
      payload: { handle },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("banned");

    const bans = await admin("bans");
    expect(bans.text).toMatch(/1\s+Alice\s+script/);
    expect((await admin("unban", "1")).code).toBe(0);
    expect(await t.login("oid-a")).toEqual(expect.any(String));
  });

  it("shows suspicious activity grouped by player and kind", async () => {
    const { t, admin } = await setup();
    const token = t.player("oid-a", "Alice");
    await t.intent(token, { type: "nope" });
    const { text } = await admin("suspicious");
    expect(text).toMatch(/Alice\s+1\s+invalid_intent\s+1/);
  });

  it("writes a backup to a file and shows the weeks", async () => {
    const { admin } = await setup();
    const file = join(dir, "manual.db");
    expect((await admin("backup", file)).text).toBe(`Backup written to ${file}.`);
    expect((await admin("backup")).code).toBe(2);
    expect((await admin("weeks")).text).toContain("season 1 week 1");
    expect((await admin("frobnicate")).code).toBe(2);
  });
});
