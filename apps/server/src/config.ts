import { dirname, join } from "node:path";

// Server configuration, read once from environment variables at startup.

export interface EntraConfig {
  /** Directory (tenant) id of Epitech. Only accounts of this tenant can log in. */
  tenantId: string;
  /** Application (client) id of the Epidle app registration. */
  clientId: string;
  /** Only needed if the redirect URI is registered as a "Web" platform. */
  clientSecret?: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  /** Origin the browser sees (the web client), e.g. https://epidle.example.org. */
  publicUrl: string;
  /** Null when the Entra ids are not set: the game API works, login does not. */
  entra: EntraConfig | null;
  /** Set when running behind a reverse proxy, so rate limits see the real client IP. */
  trustProxy: boolean;
  /** JSON file with the weekly modifiers. */
  modifiersPath: string;
  /** Null when BACKUP_DIR is set to an empty string. */
  backup: { dir: string; intervalMs: number; keep: number } | null;
}

export interface ConfigDefaults {
  dbPath: string;
  modifiersPath: string;
}

function positive(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!(value > 0) || !Number.isFinite(value)) throw new Error(`${name} must be a positive number`);
  return value;
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got ${raw}`);
  }
  return value;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** An origin. http only for a local host: the session cookie is Secure only on https. */
function publicOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`PUBLIC_URL must be a URL like https://epidle.example.org, got ${raw}`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    throw new Error(`PUBLIC_URL must use https (http only for localhost), got ${raw}`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`PUBLIC_URL must be an origin, without path or query, got ${raw}`);
  }
  return url.origin;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loadConfig(env: NodeJS.ProcessEnv, defaults: ConfigDefaults): ServerConfig {
  const tenantId = env.ENTRA_TENANT_ID?.trim();
  const clientId = env.ENTRA_CLIENT_ID?.trim();
  let entra: EntraConfig | null = null;
  if (tenantId || clientId) {
    // A GUID, not "common" or "organizations": that is what restricts login to one tenant.
    if (!tenantId || !GUID.test(tenantId)) throw new Error("ENTRA_TENANT_ID must be a tenant GUID");
    if (!clientId || !GUID.test(clientId)) throw new Error("ENTRA_CLIENT_ID must be a GUID");
    entra = { tenantId, clientId, clientSecret: env.ENTRA_CLIENT_SECRET?.trim() || undefined };
  }
  const trustProxy = env.TRUST_PROXY ?? "";
  if (!["", "0", "1"].includes(trustProxy)) throw new Error("TRUST_PROXY must be 0 or 1");
  const dbPath = env.DATABASE_PATH || defaults.dbPath;
  // Next to the database by default: better than nothing, but mount it on another disk.
  const backupDir = env.BACKUP_DIR ?? join(dirname(dbPath), "backups");
  return {
    port: integer(env, "PORT", 3000, 1, 65535),
    host: env.HOST || "127.0.0.1",
    dbPath,
    publicUrl: publicOrigin(env.PUBLIC_URL || "http://localhost:5173"),
    entra,
    trustProxy: trustProxy === "1",
    modifiersPath: env.MODIFIERS_PATH || defaults.modifiersPath,
    backup: backupDir
      ? {
          dir: backupDir,
          intervalMs: positive(env, "BACKUP_INTERVAL_HOURS", 6) * 3600_000,
          keep: integer(env, "BACKUP_KEEP", 28, 1, 10_000),
        }
      : null,
  };
}

/**
 * What a production server (NODE_ENV=production) must have on top of a valid config:
 * a server nobody can log into, or a session cookie without Secure, must not start.
 */
export function productionErrors(config: ServerConfig): string[] {
  const errors: string[] = [];
  if (!config.entra) errors.push("ENTRA_TENANT_ID and ENTRA_CLIENT_ID are required");
  if (!config.publicUrl.startsWith("https://")) errors.push("PUBLIC_URL must use https");
  return errors;
}
