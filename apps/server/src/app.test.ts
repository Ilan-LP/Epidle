import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("GET /api/health", () => {
  const app = buildApp({ dbPath: ":memory:" });

  afterAll(async () => {
    await app.close();
  });

  it("reports server and database as ok", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: "ok" });
  });
});
