import { BlockList, isIPv4 } from "node:net";
import type { HealthResponse } from "@epidle/core";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { registerApi } from "./api";
import { BROWSER_AUTH_ROUTES, registerAuth } from "./auth";
import { backupRotate } from "./backup";
import type { Db } from "./db";
import type { IdentityProvider } from "./entra";
import { API_ERRORS, sendError } from "./errors";
import { NO_MODIFIERS, type Rotation } from "./modifiers";
import { runMaintenance } from "./seasons";
import { flagSuspicious, type SuspiciousKind, scanActivity } from "./suspicious";

const SCAN_INTERVAL_MS = 3600_000;

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["127.0.0.0", 8],
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  PRIVATE.addSubnet(net, prefix, "ipv4");
}
PRIVATE.addSubnet("::1", 128, "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6");

/**
 * Only the direct peer is trusted, and only if it is on a private network (Caddy, on the Docker
 * network): the client IP is then the last X-Forwarded-For entry, the one Caddy wrote. `true`
 * would take the first entry, which any client can write itself.
 */
function trustCaddyHop(address: string, hop: number): boolean {
  if (hop !== 0) return false;
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  return PRIVATE.check(v4, isIPv4(v4) ? "ipv4" : "ipv6");
}

export type AppOptions = {
  db: Db;
  /** Null when Entra is not configured: login endpoints answer 503. */
  provider: IdentityProvider | null;
  publicUrl: string;
  /** Wall clock in ms. Injected so tests can travel in time. */
  now?: () => number;
  /** Weekly modifiers, from the config file. None by default. */
  rotation?: Rotation;
  /** Runs the season rollover / cleanup job at this interval. Off when unset (tests). */
  maintenanceIntervalMs?: number;
  /** Periodic database backups. Off when unset (tests). */
  backup?: { dir: string; intervalMs: number; keep: number };
  trustProxy?: boolean;
  logger?: boolean;
};

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { db, now = Date.now, rotation = NO_MODIFIERS } = opts;
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: opts.trustProxy ? trustCaddyHop : false,
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
    if (error.statusCode === 429) {
      // The player clicked a link: back to the login page with its error, not a JSON page.
      if (BROWSER_AUTH_ROUTES.has(request.routeOptions.url ?? "")) {
        return reply.redirect(`${opts.publicUrl}/?login=error`);
      }
      return sendError(reply, 429, "rate_limited");
    }
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

  registerApi(app, db, now, rotation);

  // Responses the official clients never cause. Logged for review, never blocked here.
  app.addHook("onResponse", async (request, reply) => {
    const intent = request.routeOptions.url === "/api/intent";
    const kind: SuspiciousKind | null =
      reply.statusCode === 429
        ? "rate_limited"
        : intent && reply.statusCode === 400
          ? "invalid_intent"
          : intent && reply.statusCode === 409
            ? "replay"
            : null;
    if (!kind) return;
    const suspicion = {
      userId: request.user?.id ?? null,
      ip: request.ip,
      kind,
      detail: `${request.method} ${request.url}`,
    };
    if (flagSuspicious(db, suspicion, now())) request.log.warn(suspicion, "suspicious activity");
  });

  const timers: NodeJS.Timeout[] = [];
  const every = (ms: number, job: () => unknown, name: string) => {
    const run = async () => {
      try {
        await job();
      } catch (e) {
        app.log.error(e, `${name} failed`);
      }
    };
    app.addHook("onReady", async () => {
      void run();
      timers.push(setInterval(run, ms));
    });
  };
  app.addHook("onClose", async () => {
    for (const t of timers) clearInterval(t);
  });

  if (opts.maintenanceIntervalMs) {
    every(
      opts.maintenanceIntervalMs,
      () => {
        const corrupted = runMaintenance(db, now(), rotation);
        if (corrupted.length)
          app.log.error({ userIds: corrupted }, "corrupted game states skipped");
      },
      "maintenance",
    );
    every(
      SCAN_INTERVAL_MS,
      () => {
        for (const s of scanActivity(db, now())) app.log.warn(s, "suspicious activity");
      },
      "activity scan",
    );
  }
  const { backup } = opts;
  if (backup) {
    every(
      backup.intervalMs,
      async () => {
        const file = await backupRotate(db, backup.dir, backup.keep, now());
        app.log.info({ file }, "database backup written");
      },
      "backup",
    );
  }

  return app;
}
