import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "./db";
import type { Identity, IdentityProvider } from "./entra";
import { sendError } from "./errors";

export interface AuthUser {
  id: number;
  pseudo: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Resolved from the session cookie or bearer token, null when not logged in. */
    user: AuthUser | null;
  }
}

export const SESSION_COOKIE = "epidle_session";
/** Binds a web login to the browser that started it (login CSRF). */
const LOGIN_COOKIE = "epidle_login";
const SESSION_MS = 30 * 24 * 3600 * 1000;
const LOGIN_MS = 10 * 60 * 1000;
// Per IP: a whole campus behind one NAT can log in at the same time, so not too tight.
// The device code start calls Microsoft, the browser routes only touch our database.
const AUTH_RATE_LIMIT = { rateLimit: { max: 120, timeWindow: 60_000 } };
/** A web login is 2 requests: this is about 300 logins a minute from one campus IP. */
const BROWSER_LOGIN_RATE_LIMIT = { rateLimit: { max: 600, timeWindow: 60_000 } };
/** Browser navigations: a JSON error page is useless there, app.ts redirects them instead. */
export const BROWSER_AUTH_ROUTES = new Set(["/api/auth/login", "/api/auth/callback"]);
// The CLI polls every few seconds while the player types the code: limited per login instead.
// Needs the parsed body, hence the later hook.
const POLL_RATE_LIMIT = {
  rateLimit: {
    hook: "preHandler" as const,
    max: 30,
    timeWindow: 60_000,
    keyGenerator: (request: FastifyRequest) =>
      `poll:${(request.body as { handle?: unknown } | undefined)?.handle}`,
  },
};

const randomToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createSession(db: Db, userId: number, now: number): string {
  const token = randomToken();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
    hashToken(token),
    userId,
    now + SESSION_MS,
  );
  return token;
}

function findSessionUser(db: Db, token: string, now: number): AuthUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.pseudo FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), now) as AuthUser | undefined;
  return row ?? null;
}

export function upsertUser(db: Db, identity: Identity, now: number): number {
  db.prepare("INSERT INTO users (ms_oid, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING").run(
    identity.oid,
    now,
  );
  const row = db.prepare("SELECT id FROM users WHERE ms_oid = ?").get(identity.oid) as {
    id: number;
  };
  return row.id;
}

/** Removed with --ban by an admin: may not log in again. */
export const isBanned = (db: Db, identity: Identity): boolean =>
  !!db.prepare("SELECT 1 FROM bans WHERE ms_oid = ?").get(identity.oid);

function sessionToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || null;
  return request.cookies[SESSION_COOKIE] ?? null;
}

/** Removes the pending request and returns its data, or null if missing or expired. */
function consumeAuthRequest(db: Db, id: string, kind: "web" | "device", now: number) {
  const row = db
    .prepare("DELETE FROM auth_requests WHERE id = ? AND kind = ? RETURNING data, expires_at")
    .get(id, kind) as { data: string; expires_at: number } | undefined;
  if (!row || row.expires_at <= now) return null;
  return JSON.parse(row.data) as Record<string, unknown>;
}

export interface AuthOptions {
  db: Db;
  provider: IdentityProvider | null;
  publicUrl: string;
  now: () => number;
}

export function registerAuth(app: FastifyInstance, { db, provider, publicUrl, now }: AuthOptions) {
  const secure = publicUrl.startsWith("https://");
  const redirectUri = `${publicUrl}/api/auth/callback`;

  app.decorateRequest("user", null);
  app.addHook("onRequest", async (request) => {
    const token = sessionToken(request);
    request.user = token ? findSessionUser(db, token, now()) : null;
  });

  const setSessionCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: SESSION_MS / 1000,
    });

  // Web: authorization code + PKCE, the server holds the verifier.
  app.get("/api/auth/login", { config: BROWSER_LOGIN_RATE_LIMIT }, async (_request, reply) => {
    if (!provider) return sendError(reply, 503, "auth_unavailable");
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken();
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    db.prepare(
      "INSERT INTO auth_requests (id, kind, data, expires_at) VALUES (?, 'web', ?, ?)",
    ).run(state, JSON.stringify({ nonce, codeVerifier }), now() + LOGIN_MS);
    reply.setCookie(LOGIN_COOKIE, state, {
      path: "/api/auth",
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: LOGIN_MS / 1000,
    });
    return reply.redirect(provider.authorizeUrl({ state, nonce, codeChallenge, redirectUri }));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/auth/callback",
    {
      config: BROWSER_LOGIN_RATE_LIMIT,
      schema: {
        querystring: {
          type: "object",
          properties: {
            code: { type: "string", maxLength: 4096 },
            state: { type: "string", maxLength: 128 },
            error: { type: "string", maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
      const fail = () => reply.redirect(`${publicUrl}/?login=error`);
      if (!provider) return fail();
      const { code, state } = request.query;
      const expected = request.cookies[LOGIN_COOKIE];
      reply.clearCookie(LOGIN_COOKIE, { path: "/api/auth" });
      if (!code || !state || state !== expected) return fail();
      const pending = consumeAuthRequest(db, state, "web", now());
      if (!pending) return fail();
      try {
        const identity = await provider.redeemCode({
          code,
          codeVerifier: String(pending.codeVerifier),
          nonce: String(pending.nonce),
          redirectUri,
        });
        if (isBanned(db, identity)) return fail();
        setSessionCookie(reply, createSession(db, upsertUser(db, identity, now()), now()));
        return reply.redirect(`${publicUrl}/`);
      } catch (e) {
        // A refused token (AuthError) or Microsoft unreachable: back to the login page either way.
        request.log.warn({ err: (e as Error).message }, "web login failed");
        return fail();
      }
    },
  );

  // CLI: device code flow, proxied so the CLI only knows an opaque handle.
  app.post("/api/auth/device", { config: AUTH_RATE_LIMIT }, async (request, reply) => {
    if (!provider) return sendError(reply, 503, "auth_unavailable");
    let start: Awaited<ReturnType<IdentityProvider["startDeviceCode"]>>;
    try {
      start = await provider.startDeviceCode();
    } catch (e) {
      // Microsoft unreachable or refusing: a clear "try later", not a 500.
      request.log.warn({ err: (e as Error).message }, "device code start failed");
      return sendError(reply, 503, "auth_unavailable");
    }
    const handle = randomToken();
    db.prepare(
      "INSERT INTO auth_requests (id, kind, data, expires_at) VALUES (?, 'device', ?, ?)",
    ).run(
      handle,
      JSON.stringify({ deviceCode: start.deviceCode, interval: start.interval, lastPollAt: 0 }),
      now() + start.expiresIn * 1000,
    );
    return {
      handle,
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      expiresIn: start.expiresIn,
      interval: start.interval,
    };
  });

  app.post<{ Body: { handle: string } }>(
    "/api/auth/device/token",
    {
      config: POLL_RATE_LIMIT,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["handle"],
          properties: { handle: { type: "string", minLength: 1, maxLength: 128 } },
        },
      },
    },
    async (request, reply) => {
      if (!provider) return sendError(reply, 503, "auth_unavailable");
      const { handle } = request.body;
      const row = db
        .prepare("SELECT data, expires_at FROM auth_requests WHERE id = ? AND kind = 'device'")
        .get(handle) as { data: string; expires_at: number } | undefined;
      if (!row || row.expires_at <= now()) {
        db.prepare("DELETE FROM auth_requests WHERE id = ?").run(handle);
        return sendError(reply, 410, "login_expired");
      }
      const data = JSON.parse(row.data) as {
        deviceCode: string;
        interval: number;
        lastPollAt: number;
      };
      // Polling faster than Microsoft allows would get us slowed down: answer locally.
      if (now() - data.lastPollAt < data.interval * 1000) {
        return { status: "pending", interval: data.interval };
      }
      let result: Awaited<ReturnType<IdentityProvider["pollDeviceCode"]>>;
      try {
        result = await provider.pollDeviceCode(data.deviceCode);
      } catch (e) {
        // The login stays pending: the CLI retries on 503, at most once per interval.
        request.log.warn({ err: (e as Error).message }, "device code poll failed");
        data.lastPollAt = now();
        db.prepare("UPDATE auth_requests SET data = ? WHERE id = ?").run(
          JSON.stringify(data),
          handle,
        );
        return sendError(reply, 503, "auth_unavailable");
      }
      if (result.status === "pending" || result.status === "slow_down") {
        if (result.status === "slow_down") data.interval += 5;
        data.lastPollAt = now();
        db.prepare("UPDATE auth_requests SET data = ? WHERE id = ?").run(
          JSON.stringify(data),
          handle,
        );
        return { status: "pending", interval: data.interval };
      }
      db.prepare("DELETE FROM auth_requests WHERE id = ?").run(handle);
      if (result.status === "denied") return sendError(reply, 403, "login_denied");
      if (result.status === "expired") return sendError(reply, 410, "login_expired");
      if (isBanned(db, result.identity)) return sendError(reply, 403, "banned");
      return {
        status: "ok",
        token: createSession(db, upsertUser(db, result.identity, now()), now()),
      };
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const token = sessionToken(request);
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) return sendError(reply, 401, "unauthorized");
}

export async function requirePlayer(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) return sendError(reply, 401, "unauthorized");
  if (request.user.pseudo === null) return sendError(reply, 403, "pseudo_required");
}
