import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Local settings of the terminal client: one session token per server, and the cosmetic
// language. The token is a 30-day bearer, so the file is readable by its owner only.

export interface Settings {
  language?: string;
  /** Session token by server origin. */
  sessions: Record<string, string>;
}

export function settingsPath(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.EPIDLE_CONFIG) return env.EPIDLE_CONFIG;
  if (platform === "win32" && env.APPDATA) return join(env.APPDATA, "epidle", "config.json");
  const base = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(base, "epidle", "config.json");
}

export function readSettings(file: string): Settings {
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as Partial<Settings>;
    const sessions: Record<string, string> = {};
    for (const [server, token] of Object.entries(data.sessions ?? {})) {
      if (typeof token === "string") sessions[server] = token;
    }
    return {
      language: typeof data.language === "string" ? data.language : undefined,
      sessions,
    };
  } catch {
    // Missing or corrupted: start fresh, the worst case is logging in again.
    return { sessions: {} };
  }
}

export function writeSettings(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  // In case the file existed with wider permissions: rename keeps the new file's mode.
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

export interface Store {
  token(): string | null;
  setToken(token: string | null): void;
  language(): string | null;
  setLanguage(id: string): void;
}

/** Settings of one server, saved on every change. */
export function createStore(file: string, server: string): Store {
  let settings = readSettings(file);
  const update = (change: (s: Settings) => void) => {
    // Re-read first: another epidle may be running against another server.
    settings = readSettings(file);
    change(settings);
    try {
      writeSettings(file, settings);
    } catch {
      // Read-only home: the session just won't survive a restart.
    }
  };
  return {
    token: () => settings.sessions[server] ?? null,
    setToken: (token) =>
      update((s) => {
        if (token) s.sessions[server] = token;
        else delete s.sessions[server];
      }),
    language: () => settings.language ?? null,
    setLanguage: (id) =>
      update((s) => {
        s.language = id;
      }),
  };
}
