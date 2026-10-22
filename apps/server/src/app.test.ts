import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { openDb } from "./db";

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
