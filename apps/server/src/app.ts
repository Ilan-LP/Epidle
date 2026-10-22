import type { HealthResponse } from "@epidle/core";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { registerApi } from "./api";
import { registerAuth } from "./auth";
import type { Db } from "./db";
import type { IdentityProvider } from "./entra";
import { API_ERRORS, sendError } from "./errors";
import { runMaintenance } from "./seasons";

export type AppOptions = {
  db: Db;
  /** Null when Entra is not configured: login endpoints answer 503. */
  provider: IdentityProvider | null;
  publicUrl: string;
  /** Wall clock in ms. Injected so tests can travel in time. */
  now?: () => number;
  /** Runs the season rollover / cleanup job at this interval. Off when unset (tests). */
  maintenanceIntervalMs?: number;
  trustProxy?: boolean;
  logger?: boolean;
};

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { db, now = Date.now } = opts;
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: opts.trustProxy ?? false,
    // Intents are a few dozen bytes.
    bodyLimit: 4096,
    ajv: {
      // Reject what we don't expect instead of silently fixing it: no type coercion,
      // no stripping of unknown fields (which also misbehaves with oneOf).
      customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false },
    },
  });

  await app.register(cookie);
  // Must be registered before any route: it attaches itself to routes as they are added.
  // Keyed by player when logged in (the whole campus may share one IP), by IP otherwise.
  // Runs on onRequest, before validation and auth checks, so invalid or anonymous spam counts
  // too. Global hooks run before route hooks: the session is already resolved here.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: 60_000,
    hook: "onRequest",
    keyGenerator: (request) => (request.user ? `user:${request.user.id}` : `ip:${request.ip}`),
    errorResponseBuilder: (_request, context) => ({
      statusCode: context.statusCode,
      error: "rate_limited",
      message: API_ERRORS.rate_limited,
    }),
  });

  registerAuth(app, { db, provider: opts.provider, publicUrl: opts.publicUrl, now });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.statusCode === 429) return sendError(reply, 429, "rate_limited");
    if (
      error.validation ||
      (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
    ) {
      return sendError(reply, error.statusCode ?? 400, "invalid_request");
    }
    request.log.error(error);
    return sendError(reply, 500, "internal");
  });

  app.get("/api/health", async (): Promise<HealthResponse> => {
    db.prepare("select 1").get();
    return { status: "ok", db: "ok" };
  });

  registerApi(app, db, now);

  if (opts.maintenanceIntervalMs) {
    const job = () => {
      try {
        runMaintenance(db, now());
      } catch (e) {
        app.log.error(e, "maintenance failed");
      }
    };
    let timer: NodeJS.Timeout | undefined;
    app.addHook("onReady", async () => {
      job();
      timer = setInterval(job, opts.maintenanceIntervalMs);
    });
    app.addHook("onClose", async () => clearInterval(timer));
  }

  return app;
}
