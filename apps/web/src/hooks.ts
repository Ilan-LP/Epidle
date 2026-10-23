import { type Language, type LanguageId, languageById } from "@epidle/api-client";
import { type Game, useGame as useSharedGame } from "@epidle/api-client/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";

export {
  type Act,
  errorMessage,
  type Game,
  type LogLine,
  usePolled,
} from "@epidle/api-client/react";

const visible = () => document.visibilityState === "visible";

/** Polls only while the tab is visible, and refreshes as soon as it is visible again. */
const BROWSER = {
  isActive: visible,
  onWake: (refresh: () => void) => {
    const onChange = () => {
      if (visible()) refresh();
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  },
};

export const useGame = (onAuthLost: () => void): Game => useSharedGame(api, onAuthLost, BROWSER);

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
