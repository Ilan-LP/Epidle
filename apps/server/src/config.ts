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
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loadConfig(env: NodeJS.ProcessEnv, defaultDbPath: string): ServerConfig {
  const tenantId = env.ENTRA_TENANT_ID?.trim();
  const clientId = env.ENTRA_CLIENT_ID?.trim();
  let entra: EntraConfig | null = null;
  if (tenantId || clientId) {
    // A GUID, not "common" or "organizations": that is what restricts login to one tenant.
    if (!tenantId || !GUID.test(tenantId)) throw new Error("ENTRA_TENANT_ID must be a tenant GUID");
    if (!clientId || !GUID.test(clientId)) throw new Error("ENTRA_CLIENT_ID must be a GUID");
    entra = { tenantId, clientId, clientSecret: env.ENTRA_CLIENT_SECRET?.trim() || undefined };
  }
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "127.0.0.1",
    dbPath: env.DATABASE_PATH ?? defaultDbPath,
    publicUrl: (env.PUBLIC_URL ?? "http://localhost:5173").replace(/\/+$/, ""),
    entra,
    trustProxy: env.TRUST_PROXY === "1",
  };
}
