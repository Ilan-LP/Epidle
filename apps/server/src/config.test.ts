import { describe, expect, it } from "vitest";
import { loadConfig, productionErrors } from "./config";

const defaults = { dbPath: "/tmp/epidle.db", modifiersPath: "/tmp/modifiers.json" };
const load = (env: NodeJS.ProcessEnv) => loadConfig(env, defaults);
const ENTRA = {
  ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  ENTRA_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
};

describe("loadConfig", () => {
  it("has safe local defaults", () => {
    expect(load({})).toMatchObject({
      port: 3000,
      host: "127.0.0.1",
      publicUrl: "http://localhost:5173",
      entra: null,
      trustProxy: false,
      backup: { keep: 28 },
    });
  });

  it("normalizes PUBLIC_URL to an origin", () => {
    expect(load({ PUBLIC_URL: "https://epidle.example.org/" }).publicUrl).toBe(
      "https://epidle.example.org",
    );
  });

  it("fails fast on values that would break or weaken the server", () => {
    for (const env of [
      { PORT: "abc" },
      { PORT: "0" },
      { PORT: "70000" },
      { PORT: "3000.5" },
      { PUBLIC_URL: "epidle.example.org" },
      { PUBLIC_URL: "http://epidle.example.org" },
      { PUBLIC_URL: "https://epidle.example.org/game" },
      { PUBLIC_URL: "javascript:alert(1)" },
      { BACKUP_KEEP: "0.2" },
      { BACKUP_KEEP: "0" },
      { BACKUP_INTERVAL_HOURS: "Infinity" },
      { TRUST_PROXY: "true" },
      { ENTRA_TENANT_ID: "common", ENTRA_CLIENT_ID: ENTRA.ENTRA_CLIENT_ID },
    ]) {
      expect(() => load(env), JSON.stringify(env)).toThrow();
    }
  });
});

describe("productionErrors", () => {
  it("requires login and https in production", () => {
    expect(productionErrors(load({}))).toHaveLength(2);
    expect(productionErrors(load({ ...ENTRA, PUBLIC_URL: "https://epidle.example.org" }))).toEqual(
      [],
    );
  });
});
