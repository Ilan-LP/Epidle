import { INTENT_ERROR_MESSAGES } from "@epidle/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type GameView, type Intent, isGameView } from "./api";
import { type Language, type LanguageId, languageById } from "./languages";
import { newer, type Projection, precheck, project, type Snapshot } from "./projection";

/** The server state never changes on its own: polling only catches clock drift and rollovers. */
const POLL_MS = 15_000;
const LOG_SIZE = 6;

/** Monotonic clock re-rendering every `ms`. */
export function useClock(ms: number): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export interface LogLine {
  id: number;
  tone: "ok" | "err" | "info";
  text: string;
}

export type Act = (intent: Intent, label: string) => Promise<void>;

export interface Game {
  projection: Projection | null;
  error: string | null;
  log: LogLine[];
  act: Act;
  say: (tone: LogLine["tone"], text: string) => void;
}

/** Turns an error into a message, or calls `onAuthLost` and returns null for 401/403. */
export function errorMessage(e: unknown, onAuthLost: () => void): string | null {
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
    onAuthLost();
    return null;
  }
  return e instanceof ApiError ? e.message : "Erreur inattendue.";
}

let nextLogId = 1;

export function useGame(onAuthLost: () => void): Game {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const lastFetch = useRef(0);
  const authLost = useRef(onAuthLost);
  authLost.current = onAuthLost;

  const say = useCallback((tone: LogLine["tone"], text: string) => {
    setLog((l) => [...l.slice(-(LOG_SIZE - 1)), { id: nextLogId++, tone, text }]);
  }, []);

  const accept = useCallback((view: GameView) => {
    setSnapshot((prev) => newer(prev, { view, receivedAt: performance.now() }));
  }, []);

  const refresh = useCallback(async () => {
    lastFetch.current = performance.now();
    try {
      accept(await api.state());
      setError(null);
    } catch (e) {
      const message = errorMessage(e, () => authLost.current());
      if (message) setError(message);
    }
  }, [accept]);

  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const id = setInterval(onVisible, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const clock = useClock(250);
  const projection = useMemo(() => snapshot && project(snapshot, clock), [snapshot, clock]);

  // The season just ended: fetch the next one (at most every 5 s if the server is late).
  const seasonOver = projection?.seasonLeft === 0;
  useEffect(() => {
    if (seasonOver && clock - lastFetch.current > 5_000) refresh();
  }, [seasonOver, clock, refresh]);

  const latest = useRef(projection);
  latest.current = projection;

  const act = useCallback<Act>(
    async (intent, label) => {
      // Same rules as the server: a refusal is explained right away, without a request.
      const refused = latest.current && precheck(latest.current.state, intent);
      if (refused) {
        say("err", `${label} : ${INTENT_ERROR_MESSAGES[refused]}`);
        return;
      }
      try {
        const r = await api.intent(intent);
        accept(r);
        const asked = "count" in intent ? (intent.count ?? 1) : 1;
        if (r.error) say("err", `${label} : ${r.applied}/${asked}, ${r.message}`);
        else say("ok", `${label} : ok`);
      } catch (e) {
        if (e instanceof ApiError && isGameView(e.body)) accept(e.body);
        const message = errorMessage(e, () => authLost.current());
        if (message) say("err", `${label} : ${message}`);
      }
    },
    [accept, say],
  );

  return { projection, error, log, act, say };
}

/** Fetches on mount, when `key` changes and every `intervalMs`. */
export function usePolled<T>(
  load: () => Promise<T>,
  key: string,
  intervalMs: number,
  onAuthLost: () => void,
): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({
    key,
    data: null,
    error: null,
  });
  const loader = useRef(load);
  loader.current = load;
  const authLost = useRef(onAuthLost);
  authLost.current = onAuthLost;

  useEffect(() => {
    let alive = true;
    const run = () =>
      loader.current().then(
        (data) => alive && setState({ key, data, error: null }),
        (e: unknown) => {
          const error = errorMessage(e, () => authLost.current());
          if (alive && error)
            setState((s) => ({ key, data: s.key === key ? s.data : null, error }));
        },
      );
    run();
    const id = setInterval(run, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [key, intervalMs]);

  // Never show data fetched for another key (e.g. the previous scope) as the current one.
  return state.key === key ? state : { data: null, error: null };
}

const LANGUAGE_KEY = "epidle.language";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Cosmetic preference, so local to the browser. Applies the colors as CSS variables. */
export function useLanguage(): [Language, (id: LanguageId) => void] {
  const [lang, setLang] = useState(() => languageById(readStorage(LANGUAGE_KEY)));
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--accent", lang.accent);
    root.setProperty("--string", lang.string);
    try {
      localStorage.setItem(LANGUAGE_KEY, lang.id);
    } catch {
      // Private mode or storage disabled: the choice just won't survive a reload.
    }
  }, [lang]);
  const select = useCallback((id: LanguageId) => setLang(languageById(id)), []);
  return [lang, select];
}

export function usePrefersReducedMotion(): boolean {
  return useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    [],
  );
}
