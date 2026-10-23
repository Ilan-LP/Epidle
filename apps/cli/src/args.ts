import { parseArgs } from "node:util";

/** Replaced by the production URL before publishing to npm. */
export const DEFAULT_SERVER_URL = "http://localhost:3000";

export type Command = "play" | "logout" | "help" | "version";

export interface CliArgs {
  command: Command;
  server: string;
}

export const USAGE = `Usage : epidle [options]

  --server <url>   serveur Epidle (défaut : $EPIDLE_SERVER_URL ou ${DEFAULT_SERVER_URL})
  --logout         se déconnecter et oublier la session de ce serveur
  -h, --help       afficher cette aide
  -v, --version    afficher la version`;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Normalized origin, or an error. Plain http only for a local server: the token is a bearer. */
export function checkServerUrl(raw: string): { url: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: `URL de serveur invalide : ${raw}` };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    return { error: `Le serveur doit être en https (ou http://localhost) : ${raw}` };
  }
  return { url: url.origin };
}

export function parseCliArgs(
  argv: string[],
  env: Record<string, string | undefined>,
): CliArgs | { error: string } {
  let values: { server?: string; logout?: boolean; help?: boolean; version?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        server: { type: "string" },
        logout: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
      strict: true,
    }));
  } catch (e) {
    return { error: (e as Error).message };
  }
  const server = checkServerUrl(values.server ?? env.EPIDLE_SERVER_URL ?? DEFAULT_SERVER_URL);
  if ("error" in server) return server;
  const command: Command = values.help
    ? "help"
    : values.version
      ? "version"
      : values.logout
        ? "logout"
        : "play";
  return { command, server: server.url };
}
