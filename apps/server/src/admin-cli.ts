import { fileURLToPath } from "node:url";
import { runAdmin } from "./admin";
import { loadConfig } from "./config";
import { openDb } from "./db";
import { loadRotation } from "./modifiers";

const config = loadConfig(process.env, {
  dbPath: fileURLToPath(new URL("../data/epidle.db", import.meta.url)),
  modifiersPath: fileURLToPath(new URL("../modifiers.json", import.meta.url)),
});
const db = openDb(config.dbPath);
try {
  process.exitCode = await runAdmin(process.argv.slice(2), {
    db,
    now: Date.now(),
    rotation: loadRotation(config.modifiersPath),
    seasonAnchor: config.seasonAnchor,
    backup: config.backup,
    out: (line) => console.log(line),
  });
} finally {
  db.close();
}
