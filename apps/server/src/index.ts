import { fileURLToPath } from "node:url";
import { buildApp } from "./app";
import { loadConfig, productionErrors } from "./config";
import { openDb } from "./db";
import { createEntraProvider } from "./entra";
import { loadRotation } from "./modifiers";

const config = loadConfig(process.env, {
  dbPath: fileURLToPath(new URL("../data/epidle.db", import.meta.url)),
  modifiersPath: fileURLToPath(new URL("../modifiers.json", import.meta.url)),
});
if (process.env.NODE_ENV === "production") {
  const errors = productionErrors(config);
  if (errors.length) throw new Error(`Refusing to start in production: ${errors.join("; ")}`);
}
// Read once: a mistake in the file stops the server at start, not at the next season.
const rotation = loadRotation(config.modifiersPath);
const db = openDb(config.dbPath);

const app = await buildApp({
  db,
  provider: config.entra && createEntraProvider(config.entra),
  publicUrl: config.publicUrl,
  trustProxy: config.trustProxy,
  rotation,
  seasonAnchor: config.seasonAnchor,
  maintenanceIntervalMs: 60_000,
  backup: config.backup ?? undefined,
  logger: true,
});
if (!config.entra) app.log.warn("ENTRA_TENANT_ID / ENTRA_CLIENT_ID not set: login is disabled");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
}

await app.listen({ port: config.port, host: config.host });
