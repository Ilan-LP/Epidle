import type { FastifyInstance } from "fastify";
import { sendError } from "./errors";

// Minimum client versions. Every official client sends `X-Epidle-Client: <kind>/<x.y.z>` on each
// API call; an older one gets 426 `client_outdated` with a French message saying how to update.

export type ClientKind = "cli" | "web";

export interface ClientVersion {
  kind: ClientKind;
  version: string;
}

export type MinVersions = Record<ClientKind, string>;

export const CLIENT_HEADER = "x-epidle-client";

/**
 * Raise one when the server stops supporting older clients (an API change they cannot handle),
 * or with MIN_CLI_VERSION / MIN_WEB_VERSION without a redeploy (a buggy published CLI).
 */
export const DEFAULT_MIN_VERSIONS: MinVersions = { cli: "0.3.0", web: "0.2.0" };

/**
 * CLI 0.1.0 and the web clients before it send no header. Such a request is taken as this
 * version: accepted while the CLI minimum is 0.1.0, refused once it is raised. They show the
 * server's `message` on any error, so even they tell the player what to do.
 */
export const LEGACY_CLIENT = "0.1.0";

/** Navigations (no custom header), and what a refused client still needs. */
const UNCHECKED_ROUTES = new Set([
  "/api/health",
  "/api/version",
  "/api/auth/login",
  "/api/auth/callback",
  "/api/auth/logout",
]);

export const UPDATE_COMMAND = "npx epidle@latest";

const OUTDATED_MESSAGES: Record<ClientKind | "unknown", string> = {
  cli: `Ta version d'Epidle n'est plus supportée. Mets-la à jour : ${UPDATE_COMMAND}`,
  web: "Cette page d'Epidle n'est plus à jour. Recharge la page pour jouer.",
  unknown: `Ta version d'Epidle n'est plus supportée. Dans le terminal : ${UPDATE_COMMAND}. Sur le web : recharge la page.`,
};

const VERSION_RE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
const HEADER_RE = /^(cli|web)\/(\d{1,6}\.\d{1,6}\.\d{1,6})$/;

export const isVersion = (v: string): boolean => VERSION_RE.test(v);

/** -1, 0 or 1, like a sort comparator. Both must pass isVersion. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** null: no header (legacy client). "invalid": a header no official client sends. */
export function parseClientHeader(
  raw: string | string[] | undefined,
): ClientVersion | null | "invalid" {
  if (raw === undefined) return null;
  const match = typeof raw === "string" ? HEADER_RE.exec(raw.trim()) : null;
  if (!match) return "invalid";
  return { kind: match[1] as ClientKind, version: match[2] as string };
}

/** The French message for an outdated client, or null if it is supported. */
export function outdatedMessage(client: ClientVersion | null, min: MinVersions): string | null {
  if (client === null) {
    return compareVersions(LEGACY_CLIENT, min.cli) < 0 ? OUTDATED_MESSAGES.unknown : null;
  }
  return compareVersions(client.version, min[client.kind]) < 0
    ? OUTDATED_MESSAGES[client.kind]
    : null;
}

declare module "fastify" {
  interface FastifyRequest {
    /** From the X-Epidle-Client header, null for a legacy client or a malformed header. */
    client: ClientVersion | null;
  }
}

export function registerClientVersion(app: FastifyInstance, min: MinVersions) {
  app.get("/api/version", async () => ({ min, update: UPDATE_COMMAND }));

  app.decorateRequest("client", null);
  app.addHook("onRequest", async (request, reply) => {
    const client = parseClientHeader(request.headers[CLIENT_HEADER]);
    if (client !== "invalid") request.client = client;
    if (UNCHECKED_ROUTES.has(request.routeOptions.url ?? "")) return;
    if (client === "invalid") return sendError(reply, 400, "invalid_request");
    const message = outdatedMessage(client, min);
    if (message) {
      return sendError(reply, 426, "client_outdated", {
        message,
        minVersion: client ? min[client.kind] : min.cli,
        update: UPDATE_COMMAND,
      });
    }
  });
}
