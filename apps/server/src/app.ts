import type { HealthResponse } from "@epidle/core";
import Fastify, { type FastifyInstance } from "fastify";
import { openDb } from "./db";

export type AppOptions = {
  dbPath: string;
  logger?: boolean;
};

export function buildApp({ dbPath, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });
  const db = openDb(dbPath);

  app.addHook("onClose", async () => {
    db.close();
  });

  app.get("/api/health", async (): Promise<HealthResponse> => {
    db.prepare("select 1").get();
    return { status: "ok", db: "ok" };
  });

  return app;
}
