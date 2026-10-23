import type { GameState, HireKind, Rates, StageId } from "@epidle/core";

// Thin client for the server API, shared by the web and terminal clients. Every response that
// carries a game view (state, intent, and the 409/422 intent errors) is the new source of truth.

export interface SeasonView {
  id: number;
  startsAt: number;
  endsAt: number;
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
  entries: { rank: number; pseudo: string; score: number }[];
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
}

export type Intent =
  | { type: "hire"; kind: HireKind; count?: number }
  | { type: "train"; devId: number; targetLevel?: number }
  | { type: "buyRoom"; count?: number }
  | { type: "buyMouli"; stage: StageId; count?: number }
  | { type: "upgradeMouli"; stage: StageId; count?: number }
  | { type: "setStrictness"; stage: StageId; level: number };

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

export interface ApiOptions {
  /** Server origin, e.g. "https://epidle.example.org". Empty for same origin (web). */
  baseUrl?: string;
  /** Session token sent as a bearer (CLI). The web client relies on its httpOnly cookie. */
  token?: () => string | null;
  fetch?: typeof fetch;
}

export type Api = ReturnType<typeof createApi>;

export function createApi({ baseUrl = "", token, fetch: doFetch = fetch }: ApiOptions = {}) {
  const root = baseUrl.replace(/\/+$/, "");

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
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
    const data: unknown = await res.json().catch(() => null);
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
    me: () => request<{ pseudo: string | null }>("GET", "/api/me"),
    setPseudo: (pseudo: string) => request<{ pseudo: string }>("PUT", "/api/me/pseudo", { pseudo }),
    state: () => request<GameView>("GET", "/api/state"),
    intent: (intent: Intent) =>
      request<IntentResponse>("POST", "/api/intent", { ...intent, requestId: newRequestId() }),
    leaderboard: (scope: Scope) => request<Leaderboard>("GET", `/api/leaderboard?scope=${scope}`),
    build: (pseudo: string) =>
      request<PlayerBuild>("GET", `/api/players/${encodeURIComponent(pseudo)}/build`),
    logout: () => request<void>("POST", "/api/auth/logout"),
    /** Starts a device code login (CLI). */
    deviceStart: () => request<DeviceLogin>("POST", "/api/auth/device"),
    /** 410 once expired, 403 if the player refused. */
    devicePoll: (handle: string) =>
      request<DevicePoll>("POST", "/api/auth/device/token", { handle }),
  };
}

/** Mirrors the server rule, so the form can say what is wrong before sending. */
export const PSEUDO_RE = /^[A-Za-z0-9_-]{3,16}$/;
