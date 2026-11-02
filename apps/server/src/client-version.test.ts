import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import {
  compareVersions,
  DEFAULT_MIN_VERSIONS,
  outdatedMessage,
  parseClientHeader,
} from "./client-version";
import { loadConfig } from "./config";
import { openDb } from "./db";
import { LEGACY_MIN_VERSIONS, testApp } from "./test-utils";

describe("versions", () => {
  it("compare numerically, not as text", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
  });

  it("parse the client header", () => {
    expect(parseClientHeader(undefined)).toBeNull();
    expect(parseClientHeader("cli/0.2.0")).toEqual({ kind: "cli", version: "0.2.0" });
    expect(parseClientHeader(" web/1.2.3 ")).toEqual({ kind: "web", version: "1.2.3" });
    for (const bad of ["cli", "cli/1.2", "bot/1.0.0", "cli/1.0.0-beta", "cli/1.0.0/x"]) {
      expect(parseClientHeader(bad)).toBe("invalid");
    }
    expect(parseClientHeader(["cli/1.0.0", "cli/1.0.0"])).toBe("invalid");
  });

  it("tell each kind of client how to update, in French", () => {
    const min = { cli: "0.2.0", web: "0.3.0" };
    expect(outdatedMessage({ kind: "cli", version: "0.2.0" }, min)).toBeNull();
    expect(outdatedMessage({ kind: "cli", version: "0.1.5" }, min)).toContain("npx epidle@latest");
    expect(outdatedMessage({ kind: "web", version: "0.2.9" }, min)).toContain("Recharge la page");
    // No header: a CLI 0.1.0 or an old web tab, we cannot tell which.
    expect(outdatedMessage(null, min)).toMatch(/npx epidle@latest.*recharge la page/);
    expect(outdatedMessage(null, LEGACY_MIN_VERSIONS)).toBeNull();
  });

  it("come from the environment, with defaults", () => {
    const defaults = { dbPath: "x.db", modifiersPath: "m.json" };
    expect(loadConfig({}, defaults).minVersions).toEqual(DEFAULT_MIN_VERSIONS);
    expect(loadConfig({ MIN_CLI_VERSION: "0.3.0" }, defaults).minVersions.cli).toBe("0.3.0");
    expect(() => loadConfig({ MIN_WEB_VERSION: "latest" }, defaults)).toThrow(/MIN_WEB_VERSION/);
  });
});

describe("version check", () => {
  let close: () => Promise<unknown> = async () => undefined;
  afterEach(() => close());

  async function app(min = { cli: "0.2.0", web: "0.1.0" }) {
    const db = openDb(":memory:");
    const a = await buildApp({
      db,
      provider: null,
      publicUrl: "http://localhost:5173",
      minVersions: min,
    });
    close = () => a.close();
    return a;
  }

  it("refuses outdated clients with 426 and how to update", async () => {
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/api/me",
      headers: { "x-epidle-client": "cli/0.1.9" },
    });
    expect(res.statusCode).toBe(426);
    expect(res.json()).toEqual({
      error: "client_outdated",
      message: "Ta version d'Epidle n'est plus supportée. Mets-la à jour : npx epidle@latest",
      minVersion: "0.2.0",
      update: "npx epidle@latest",
    });
    const web = await a.inject({
      method: "POST",
      url: "/api/intent",
      headers: { "x-epidle-client": "web/0.0.9" },
      payload: {},
    });
    expect(web.statusCode).toBe(426);
    expect(web.json().message).toContain("Recharge la page");
  });

  it("checks before authentication, lets supported clients through", async () => {
    const a = await app();
    const me = (client: string) =>
      a.inject({ method: "GET", url: "/api/me", headers: { "x-epidle-client": client } });
    expect((await me("cli/0.2.0")).statusCode).toBe(401);
    expect((await me("web/2.0.0")).statusCode).toBe(401);
    expect((await me("curl/8.0.0")).statusCode).toBe(400);
  });

  it("accepts clients without a header only while the CLI minimum is 0.1.0", async () => {
    expect((await (await app(LEGACY_MIN_VERSIONS)).inject("/api/me")).statusCode).toBe(401);
    expect((await (await app()).inject("/api/me")).statusCode).toBe(426);
    expect((await (await app(DEFAULT_MIN_VERSIONS)).inject("/api/me")).statusCode).toBe(426);
  });

  it("never blocks the version, health, browser login and logout routes", async () => {
    const a = await app({ cli: "9.0.0", web: "9.0.0" });
    const version = await a.inject("/api/version");
    expect(version.json()).toEqual({
      min: { cli: "9.0.0", web: "9.0.0" },
      update: "npx epidle@latest",
    });
    expect((await a.inject("/api/health")).statusCode).toBe(200);
    expect((await a.inject("/api/auth/login")).statusCode).toBe(503);
    expect((await a.inject({ method: "POST", url: "/api/auth/logout" })).statusCode).toBe(204);
    expect((await a.inject({ method: "POST", url: "/api/auth/device" })).statusCode).toBe(426);
  });

  it("lets today's game run unchanged with the default minimums", async () => {
    const t = await testApp();
    close = () => t.app.close();
    const token = t.player("oid-a", "Alice");
    expect((await t.get(token, "/api/state")).statusCode).toBe(200);
  });
});
