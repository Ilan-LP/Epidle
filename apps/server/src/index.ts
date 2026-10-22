import { fileURLToPath } from "node:url";
import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const dbPath =
  process.env.DATABASE_PATH ?? fileURLToPath(new URL("../data/epidle.db", import.meta.url));

const app = buildApp({ dbPath, logger: true });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port, host });
