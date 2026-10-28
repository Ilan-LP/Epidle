import type { GameState, HireKind, Modifier, Rates, SeasonWeeks, StageId } from "@epidle/core";
import type { Award } from "./awards";

// Thin client for the server API, shared by the web and terminal clients. Every response that
// carries a game view (state, intent, and the 409/422 intent errors) is the new source of truth.

export interface SeasonView {
  id: number;
  startsAt: number;
  endsAt: number;
  /** Weekly modifiers, null for a normal week. */
  weeks: SeasonWeeks;
}

export interface GameView {
  /** Server clock (ms) at which `state` was computed. */
  serverTime: number;
  season: SeasonView;
  state: GameState;
  rates: Rates;
}

export interface IntentResponse extends GameView {
  applied: number;
  error: string | null;
  message: string | null;
}

export type Scope = "season" | "alltime";

export interface Leaderboard {
  scope: Scope;
  season: SeasonView;
  /** `title`: the player's best badge of any past season. */
  entries: { rank: number; pseudo: string; score: number; title: Award | null }[];
  me: { rank: number; score: number } | null;
}

export interface PlayerBuild {
  pseudo: string;
  season: SeasonView;
  tier: number;
  score: number;
  headcount: number;
  rooms: number;
  team: { kind: HireKind; level: number; count: number; training: number }[];
  stages: { id: StageId; instances: number; version: number; strictness: number }[];
  /** Badges of past seasons, newest first. */
  badges: Award[];
}

export interface FeedEvent {
  at: number;
  kind: "tier" | "level" | "lead" | "top10";
  pseudo: string;
  /** Tier index, dev level or rank. */
  value: number;
  /** First of the season to reach this tier or level. */
  first: boolean;
}

/** What changed this week of the season. */
export interface Feed {
  season: SeasonView;
  week: { index: number; startsAt: number; endsAt: number; modifier: Modifier | null };
  /** Newest first. */
  events: FeedEvent[];
  /** Biggest score gains since the week started. */
  climbers: { pseudo: string; gain: number }[];
  players: number;
  /** Players whose company started this week. */
  joined: number;
}

export type Intent =
  | { type: "hire"; kind: HireKind; count?: number }
  | { type: "train"; devId: number; targetLevel?: number }
  | { type: "buyRoom"; count?: number }
  | { type: "buyMouli"; stage: StageId; count?: number }
  | { type: "upgradeMouli"; stage: StageId; count?: number }
  | { type: "setStrictness"; stage: StageId; level: number };

export interface MouliChallenge {
  id: string;
  ascii: string[];
  expiresIn: number;
}

export function isMouliCheck(e: unknown): e is ApiError & { body: { challenge: MouliChallenge } } {
  return (
    e instanceof ApiError &&
    e.status === 403 &&
    e.code === "mouli_check_required" &&
    typeof e.body === "object" &&
    e.body !== null &&
    "challenge" in e.body
  );
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export const isGameView = (body: unknown): body is GameView =>
  typeof body === "object" && body !== null && "state" in body && "serverTime" in body;

/** 128 random bits in hex. Not crypto.randomUUID: it only exists in secure contexts. */
export function newRequestId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// C0/C1 control characters (ANSI escapes start with ESC) and bidi overrides: a server could use
// them to rewrite the terminal or reorder text. The official server never sends any.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** Copy of a JSON value with control characters removed from every string. */
export function stripControl(value: unknown): unknown {
  if (typeof value === "string") return value.replace(CONTROL, "");
  if (Array.isArray(value)) return value.map(stripControl);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripControl(v);
    return out;
  }
  return value;
}

export interface DeviceLogin {
  /** Opaque id of this login on the Epidle server, to poll with. */
  handle: string;
  /** Code the player types on the Microsoft page. */
  userCode: string;
  verificationUri: string;
  /** Seconds. */
  expiresIn: number;
  /** Seconds between two polls. */
  interval: number;
}

export type DevicePoll = { status: "pending"; interval: number } | { status: "ok"; token: string };

/** Sent on every call as `X-Epidle-Client: <kind>/<version>`, checked against the server minimum. */
export interface ClientInfo {
  kind: "cli" | "web";
  /** x.y.z, from the client's package.json. */
  version: string;
}

/** How a player updates the terminal client. The server's 426 message says the same. */
export const UPDATE_COMMAND = "npx epidle@latest";

/** The server refuses this client version (426): the player must update. */
export const isOutdated = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 426;

export interface ApiOptions {
  /** Server origin, e.g. "https://epidle.example.org". Empty for same origin (web). */
  baseUrl?: string;
  /** Session token sent as a bearer (CLI). The web client relies on its httpOnly cookie. */
  token?: () => string | null;
  client?: ClientInfo;
  fetch?: typeof fetch;
}

export type Api = ReturnType<typeof createApi>;

export function createApi({
  baseUrl = "",
  token,
  client,
  fetch: doFetch = fetch,
}: ApiOptions = {}) {
  const root = baseUrl.replace(/\/+$/, "");

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (client) headers["x-epidle-client"] = `${client.kind}/${client.version}`;
    const bearer = token?.();
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    let res: Response;
    try {
      res = await doFetch(`${root}${path}`, {
        method,
        credentials: "same-origin",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "network", "Serveur injoignable.", null);
    }
    if (res.status === 204) return undefined as T;
    const data = stripControl(await res.json().catch(() => null));
    if (!res.ok) {
      const err = (data ?? {}) as { error?: string; message?: string };
      throw new ApiError(
        res.status,
        err.error ?? "internal",
        err.message ?? `Erreur ${res.status}.`,
        data,
      );
    }
    return data as T;
  }

  return {
    /** Oldest client versions the server accepts. Never refused, even to an outdated client. */
    version: () =>
      request<{ min: Record<ClientInfo["kind"], string>; update: string }>("GET", "/api/version"),
    me: () => request<{ pseudo: string | null }>("GET", "/api/me"),
    setPseudo: (pseudo: string) => request<{ pseudo: string }>("PUT", "/api/me/pseudo", { pseudo }),
    state: () => request<GameView>("GET", "/api/state"),
    intent: (intent: Intent) =>
      request<IntentResponse>("POST", "/api/intent", { ...intent, requestId: newRequestId() }),
    leaderboard: (scope: Scope) => request<Leaderboard>("GET", `/api/leaderboard?scope=${scope}`),
    feed: () => request<Feed>("GET", "/api/feed"),
    build: (pseudo: string) =>
      request<PlayerBuild>("GET", `/api/players/${encodeURIComponent(pseudo)}/build`),
    /** `everywhere`: ends every session of the player, on every device. */
    logout: (everywhere = false) =>
      request<void>("POST", `/api/auth/logout${everywhere ? "?all=1" : ""}`),
    /** Starts a device code login (CLI). */
    deviceStart: () => request<DeviceLogin>("POST", "/api/auth/device"),
    /** 410 once expired, 403 if the player refused. */
    devicePoll: (handle: string) =>
      request<DevicePoll>("POST", "/api/auth/device/token", { handle }),
    /** Solves an anti-bot Mouli Check challenge. */
    solveMouliCheck: (id: string, answer: string) =>
      request<{ ok: boolean }>("POST", "/api/mouli-check/solve", { id, answer }),
  };
}

/** Mirrors the server rule, so the form can say what is wrong before sending. */
export const PSEUDO_RE = /^[A-Za-z0-9_-]{3,16}$/;
