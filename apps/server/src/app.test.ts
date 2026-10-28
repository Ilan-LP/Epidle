import { afterAll, describe, expect, it } from "vitest";
import { buildApp, redactUrl } from "./app";
import { openDb } from "./db";
import { LEGACY_MIN_VERSIONS } from "./test-utils";

describe("GET /api/health", async () => {
  const app = await buildApp({ db: openDb(":memory:"), provider: null, publicUrl: "http://x" });
  afterAll(() => app.close());

  it("reports server and database as ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("disables login cleanly when Entra is not configured", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/login" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("auth_unavailable");
  });
});

describe("behind the reverse proxy", () => {
  it("takes the client IP Caddy appended, not one the client forged", async () => {
    const app = await buildApp({
      db: openDb(":memory:"),
      provider: null,
      publicUrl: "http://x",
      trustProxy: true,
      minVersions: LEGACY_MIN_VERSIONS,
    });
    app.get("/ip", async (request) => ({ ip: request.ip }));
    const res = await app.inject({
      method: "GET",
      url: "/ip",
      headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7" },
    });
    expect(res.json()).toEqual({ ip: "203.0.113.7" });
    // Reached directly from the internet (port published by mistake): the header is ignored.
    const direct = await app.inject({
      method: "GET",
      url: "/ip",
      remoteAddress: "198.51.100.9",
      headers: { "x-forwarded-for": "6.6.6.6" },
    });
    expect(direct.json()).toEqual({ ip: "198.51.100.9" });
    await app.close();
  });
});

describe("request logs", () => {
  it("never contain the OAuth code of the login callback", () => {
    expect(redactUrl("/api/auth/callback?code=SECRET&state=abc")).toBe(
      "/api/auth/callback?[redacted]",
    );
    expect(redactUrl("/api/leaderboard?scope=alltime")).toBe("/api/leaderboard?scope=alltime");
    expect(redactUrl("/api/state")).toBe("/api/state");
  });
});
