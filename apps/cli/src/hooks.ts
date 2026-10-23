import { type Api, type Language, type LanguageId, languageById } from "@epidle/api-client";
import { type Game, useGame as useSharedGame } from "@epidle/api-client/react";
import { createContext, useCallback, useContext, useState } from "react";
import type { Store } from "./store";

export interface Client {
  api: Api;
  store: Store;
  /** Server origin, also where the web client lives. */
  server: string;
}

export const ClientContext = createContext<Client | null>(null);

export function useClient(): Client {
  const client = useContext(ClientContext);
  if (!client) throw new Error("ClientContext missing");
  return client;
}

/** A terminal is always "visible": plain polling. */
export const useGame = (onAuthLost: () => void): Game => useSharedGame(useClient().api, onAuthLost);

export function useLanguage(store: Store): [Language, (id: LanguageId) => void] {
  const [lang, setLang] = useState(() => languageById(store.language()));
  const select = useCallback(
    (id: LanguageId) => {
      setLang(languageById(id));
      store.setLanguage(id);
    },
    [store],
  );
  return [lang, select];
}
