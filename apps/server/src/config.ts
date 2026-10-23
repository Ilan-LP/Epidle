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
  if (!(value > 0)) throw new Error(`${name} must be a positive number`);
  return value;
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
  const dbPath = env.DATABASE_PATH || defaults.dbPath;
  // Next to the database by default: better than nothing, but mount it on another disk.
  const backupDir = env.BACKUP_DIR ?? join(dirname(dbPath), "backups");
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "127.0.0.1",
    dbPath,
    publicUrl: (env.PUBLIC_URL ?? "http://localhost:5173").replace(/\/+$/, ""),
    entra,
    trustProxy: env.TRUST_PROXY === "1",
    modifiersPath: env.MODIFIERS_PATH || defaults.modifiersPath,
    backup: backupDir
      ? {
          dir: backupDir,
          intervalMs: positive(env, "BACKUP_INTERVAL_HOURS", 6) * 3600_000,
          keep: Math.round(positive(env, "BACKUP_KEEP", 28)),
        }
      : null,
  };
}
