import {
  currentWeek,
  effectsText,
  formatDuration,
  formatMoney,
  formatRate,
  LANGUAGES,
  type Language,
  type LanguageId,
  type Projection,
} from "@epidle/api-client";
import { type Game as GameData, useGame } from "./hooks";
import { useShortcuts } from "./keys";
import { href, navigate, type Route, useRoute } from "./router";
import { Header } from "./Shell";
import { Dashboard } from "./screens/Dashboard";
import { Help } from "./screens/Help";
import { Leaderboard } from "./screens/Leaderboard";
import { PlayerBuild } from "./screens/PlayerBuild";
import { PseudoForm } from "./screens/PseudoForm";
import { Shop } from "./screens/Shop";

const NAV: { route: Route; key: string; label: string }[] = [
  { route: { name: "dashboard" }, key: "t", label: "tableau" },
  { route: { name: "shop" }, key: "b", label: "boutique" },
  { route: { name: "leaderboard" }, key: "c", label: "classement" },
  { route: { name: "help" }, key: "?", label: "aide" },
];

interface Props {
  pseudo: string;
  lang: Language;
  setLang: (id: LanguageId) => void;
  onAuthLost: () => void;
  onPseudo: (pseudo: string) => void;
  onLogout: () => void;
}

export function Game({ pseudo, lang, setLang, onAuthLost, onPseudo, onLogout }: Props) {
  const route = useRoute();
  const game = useGame(onAuthLost);

  useShortcuts({
    ...Object.fromEntries(NAV.map((n) => [n.key, () => navigate(n.route)])),
    l: () => {
      const i = LANGUAGES.findIndex((l) => l.id === lang.id);
      setLang((LANGUAGES[(i + 1) % LANGUAGES.length] ?? lang).id);
    },
  });

  const current = route.name === "player" ? "leaderboard" : route.name;
  return (
    <div className="app">
      <Header lang={lang} setLang={setLang} pseudo={pseudo}>
        <nav aria-label="Navigation">
          {NAV.map((n) => (
            <a
              key={n.key}
              href={href(n.route)}
              className={n.route.name === current ? "btn active" : "btn"}
              aria-current={n.route.name === current ? "page" : undefined}
            >
              <kbd className="key">{n.key}</kbd>
              {n.label}
            </a>
          ))}
        </nav>
      </Header>
      <StatusBar game={game} />
      {game.projection && <WeekBanner p={game.projection} />}
      <main>
        <Screen
          route={route}
          game={game}
          pseudo={pseudo}
          lang={lang}
          onAuthLost={onAuthLost}
          onPseudo={onPseudo}
          onLogout={onLogout}
        />
      </main>
      <Log game={game} lang={lang} />
    </div>
  );
}

function Screen({
  route,
  game,
  pseudo,
  lang,
  onAuthLost,
  onPseudo,
  onLogout,
}: { route: Route; game: GameData } & Omit<Props, "setLang">) {
  // Screens that don't need the game state render right away.
  if (route.name === "leaderboard") return <Leaderboard me={pseudo} onAuthLost={onAuthLost} />;
  if (route.name === "help") return <Help pseudo={pseudo} onLogout={onLogout} />;
  if (route.name === "pseudo") {
    const back = () => navigate({ name: "help" });
    return (
      <PseudoForm
        current={pseudo}
        onDone={(p) => {
          onPseudo(p);
          back();
        }}
        onCancel={back}
      />
    );
  }
  const p = game.projection;
  if (!p) return <p className={game.error ? "bad" : "dim"}>{game.error ?? "chargement…"}</p>;
  switch (route.name) {
    case "shop":
      return <Shop p={p} act={game.act} />;
    case "player":
      return (
        <PlayerBuild pseudo={route.pseudo} me={pseudo} mine={p.state} onAuthLost={onAuthLost} />
      );
    default:
      return <Dashboard p={p} act={game.act} say={game.say} lang={lang} pseudo={pseudo} />;
  }
}

function StatusBar({ game }: { game: GameData }) {
  const p = game.projection;
  if (!p) return null;
  const over = p.seasonLeft === 0;
  return (
    <div className="status" role="status" aria-live="off">
      <span>
        <strong>{formatMoney(p.state.money)}</strong>{" "}
        <span className={p.rates.netPerSecond >= 0 ? "ok" : "bad"}>
          {formatRate(p.rates.netPerSecond)}
        </span>
      </span>
      <span>score {formatMoney(p.state.revenue)}</span>
      <span className={over ? "warn" : "dim"}>
        {over
          ? "saison terminée, la suivante arrive"
          : `fin de saison dans ${formatDuration(p.seasonLeft)}`}
      </span>
      {game.error && <span className="bad">{game.error}</span>}
    </div>
  );
}

/** The weekly modifier, announced on every screen: it changes what is worth buying. */
function WeekBanner({ p }: { p: Projection }) {
  const w = currentWeek(p);
  const label = `Semaine ${w.index + 1}/${w.count}`;
  return (
    <div className={w.modifier ? "week active" : "week"}>
      {w.modifier ? (
        <>
          <strong className="accent">
            {label} · {w.modifier.name}
          </strong>{" "}
          {w.modifier.description} <span className="dim">({effectsText(w.modifier.effects)})</span>
        </>
      ) : (
        <span className="dim">{label} · semaine normale</span>
      )}
      <span className="dim">
        {" "}
        · fin dans {formatDuration(w.left)}
        {w.next !== undefined && ` · ensuite : ${w.next?.name ?? "semaine normale"}`}
      </span>
    </div>
  );
}

function Log({ game, lang }: { game: GameData; lang: Language }) {
  return (
    <footer className="log" aria-live="polite">
      {game.log.length === 0 ? (
        <div className="dim">
          {lang.prompt} <span className="cursor">_</span>
        </div>
      ) : (
        game.log.map((l) => (
          <div
            key={l.id}
            className={l.tone === "err" ? "bad" : l.tone === "ok" ? undefined : "dim"}
          >
            <span className="dim">{lang.prompt}</span> {l.text}
          </div>
        ))
      )}
    </footer>
  );
}
