import { ApiError } from "@epidle/api-client";
import { Box, Text, useApp } from "ink";
import { useCallback, useEffect, useState } from "react";
import { Game } from "./Game";
import { useClient, useLanguage } from "./hooks";
import { useKeys } from "./keys";
import { Login } from "./screens/Login";
import { PseudoForm } from "./screens/PseudoForm";
import { LanguageContext, T } from "./ui";

type Auth =
  | { status: "loading" }
  | { status: "offline"; message: string }
  | { status: "anon" }
  | { status: "pseudo" }
  | { status: "player"; pseudo: string };

export function App() {
  const { api, store, server } = useClient();
  const { exit } = useApp();
  const [lang, setLang] = useLanguage(store);
  const [auth, setAuth] = useState<Auth>(() =>
    store.token() ? { status: "loading" } : { status: "anon" },
  );

  const check = useCallback(async () => {
    if (!store.token()) {
      setAuth({ status: "anon" });
      return;
    }
    try {
      const me = await api.me();
      setAuth(me.pseudo ? { status: "player", pseudo: me.pseudo } : { status: "pseudo" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Expired or revoked: forget it and log in again.
        store.setToken(null);
        setAuth({ status: "anon" });
      } else {
        setAuth({
          status: "offline",
          message: e instanceof ApiError ? e.message : "Erreur inattendue.",
        });
      }
    }
  }, [api, store]);

  useEffect(() => {
    check();
  }, [check]);

  const logout = useCallback(
    async (everywhere = false) => {
      await api.logout(everywhere).catch(() => undefined);
      store.setToken(null);
      setAuth({ status: "anon" });
    },
    [api, store],
  );

  const offline = auth.status === "offline" || auth.status === "loading";
  useKeys({ r: check, q: exit }, offline);

  return (
    <LanguageContext.Provider value={lang}>
      {auth.status === "player" ? (
        <Game
          pseudo={auth.pseudo}
          setLang={setLang}
          onAuthLost={check}
          onPseudo={(pseudo) => setAuth({ status: "player", pseudo })}
          onLogout={logout}
        />
      ) : (
        <Box flexDirection="column" paddingX={1}>
          {auth.status === "loading" && <T tone="dim">connexion à {server}…</T>}
          {auth.status === "offline" && (
            <>
              <T tone="bad">{auth.message}</T>
              <T tone="dim">{server}</T>
              <Text> </Text>
              <T tone="dim">[r] réessayer · [q] quitter</T>
            </>
          )}
          {auth.status === "anon" && (
            <Login
              onToken={(token) => {
                store.setToken(token);
                setAuth({ status: "loading" });
                check();
              }}
            />
          )}
          {auth.status === "pseudo" && (
            <PseudoForm current={null} onDone={(pseudo) => setAuth({ status: "player", pseudo })} />
          )}
        </Box>
      )}
    </LanguageContext.Provider>
  );
}
