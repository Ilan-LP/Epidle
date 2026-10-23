import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "./api";
import { Game } from "./Game";
import { useLanguage } from "./hooks";
import { Header } from "./Shell";
import { Login } from "./screens/Login";
import { PseudoForm } from "./screens/PseudoForm";

type Auth =
  | { status: "loading" }
  | { status: "offline"; message: string }
  | { status: "anon" }
  | { status: "pseudo" }
  | { status: "player"; pseudo: string };

/** The server redirects to /?login=error when a login fails. Read it once, then clean the URL. */
function takeLoginError(): boolean {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("login")) return false;
  const failed = url.searchParams.get("login") === "error";
  url.searchParams.delete("login");
  window.history.replaceState(null, "", url);
  return failed;
}

export function App() {
  const [lang, setLang] = useLanguage();
  const [auth, setAuth] = useState<Auth>({ status: "loading" });
  const [loginError] = useState(takeLoginError);

  const check = useCallback(async () => {
    try {
      const me = await api.me();
      setAuth(me.pseudo ? { status: "player", pseudo: me.pseudo } : { status: "pseudo" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuth({ status: "anon" });
      else
        setAuth({
          status: "offline",
          message: e instanceof ApiError ? e.message : "Erreur inattendue.",
        });
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setAuth({ status: "anon" });
  }, []);

  if (auth.status === "player") {
    return (
      <Game
        pseudo={auth.pseudo}
        lang={lang}
        setLang={setLang}
        onAuthLost={check}
        onPseudo={(pseudo) => setAuth({ status: "player", pseudo })}
        onLogout={logout}
      />
    );
  }

  return (
    <div className="app">
      <Header lang={lang} setLang={setLang} />
      <main>
        {auth.status === "loading" && <p className="dim">connexion…</p>}
        {auth.status === "offline" && (
          <div className="center">
            <p className="bad">{auth.message}</p>
            <p>
              <button type="button" className="btn" onClick={check}>
                Réessayer
              </button>
            </p>
          </div>
        )}
        {auth.status === "anon" && <Login error={loginError} />}
        {auth.status === "pseudo" && (
          <PseudoForm current={null} onDone={(pseudo) => setAuth({ status: "player", pseudo })} />
        )}
      </main>
    </div>
  );
}
