import {
  formatDuration,
  formatMoney,
  formatRate,
  LANGUAGES,
  type LanguageId,
} from "@epidle/api-client";
import type { Game as GameData } from "@epidle/api-client/react";
import { Box, type DOMElement, Text, useApp, useBoxMetrics, useWindowSize } from "ink";
import { useRef, useState } from "react";
import { useGame } from "./hooks";
import { useKeys } from "./keys";
import { Dashboard } from "./screens/Dashboard";
import { Help } from "./screens/Help";
import { Leaderboard } from "./screens/Leaderboard";
import { PlayerBuild } from "./screens/PlayerBuild";
import { PseudoForm } from "./screens/PseudoForm";
import { Shop } from "./screens/Shop";
import { A, K, T, useLang } from "./ui";

export type Route =
  | { name: "dashboard" | "shop" | "leaderboard" | "help" | "pseudo" }
  | { name: "player"; pseudo: string };

export type Navigate = (route: Route) => void;

const NAV: { name: "dashboard" | "shop" | "leaderboard" | "help"; key: string; label: string }[] = [
  { name: "dashboard", key: "t", label: "tableau" },
  { name: "shop", key: "b", label: "boutique" },
  { name: "leaderboard", key: "c", label: "classement" },
  { name: "help", key: "?", label: "aide" },
];

/** Lines taken by the header, status bar and log: the screen gets the rest. */
const CHROME_LINES = 7;

/** Screen width from which panels sit side by side. */
export const WIDE = 110;

interface Props {
  pseudo: string;
  setLang: (id: LanguageId) => void;
  onAuthLost: () => void;
  onPseudo: (pseudo: string) => void;
  onLogout: () => void;
}

export function Game({ pseudo, setLang, onAuthLost, onPseudo, onLogout }: Props) {
  const { exit } = useApp();
  const lang = useLang();
  const { columns, rows } = useWindowSize();
  const [route, setRoute] = useState<Route>({ name: "dashboard" });
  const [scroll, setScroll] = useState(0);
  const navigate: Navigate = (r) => {
    setRoute(r);
    setScroll(0);
  };
  const game = useGame(onAuthLost);
  const typing = route.name === "pseudo";

  useKeys(
    {
      ...Object.fromEntries(NAV.map((n) => [n.key, () => navigate({ name: n.name })])),
      l: () => {
        const i = LANGUAGES.findIndex((l) => l.id === lang.id);
        setLang((LANGUAGES[(i + 1) % LANGUAGES.length] ?? lang).id);
      },
      q: exit,
      pageup: () => page(-1),
      pagedown: () => page(1),
    },
    !typing,
  );

  const current = route.name === "player" ? "leaderboard" : route.name;
  const height = Math.max(3, rows - CHROME_LINES);
  // Small terminals: the screen scrolls instead of being cut.
  const content = useRef<DOMElement>(null);
  const maxScroll = Math.max(0, useBoxMetrics(content).height - height);
  const offset = Math.min(scroll, maxScroll);
  const page = (dir: number) =>
    setScroll(Math.min(maxScroll, Math.max(0, offset + dir * Math.max(1, height - 2))));
  return (
    <Box flexDirection="column" width={columns} height={rows} paddingX={1}>
      <Box justifyContent="space-between">
        <Text wrap="truncate">
          <A bold>{lang.file}</A>
          <T tone="dim"> · {pseudo}</T>
        </Text>
        <Text>
          <T tone="dim">langage </T>
          {lang.name} <K k="l" />
        </Text>
      </Box>
      <Text wrap="truncate">
        {NAV.map((n) => (
          <Text key={n.key}>
            <K k={n.key} />
            {n.name === current ? <Text inverse>{n.label}</Text> : n.label}{" "}
          </Text>
        ))}
        <K k="q" />
        quitter
        {maxScroll > 0 && (
          <T tone="warn">
            {"  "}
            {offset < maxScroll ? "[PgDn] suite" : "[PgUp] haut"}
          </T>
        )}
      </Text>
      <StatusBar game={game} />
      <Box flexDirection="column" height={height} overflow="hidden" contentOffsetY={offset}>
        {/* No shrinking: Ink boxes shrink by default and their lines would overlap. */}
        <Box ref={content} flexDirection="column" flexShrink={0}>
          <Screen
            route={route}
            navigate={navigate}
            game={game}
            pseudo={pseudo}
            height={height}
            wide={columns >= WIDE}
            onAuthLost={onAuthLost}
            onPseudo={onPseudo}
            onLogout={onLogout}
          />
        </Box>
      </Box>
      <Log game={game} />
    </Box>
  );
}

function Screen({
  route,
  navigate,
  game,
  pseudo,
  height,
  wide,
  onAuthLost,
  onPseudo,
  onLogout,
}: {
  route: Route;
  navigate: Navigate;
  game: GameData;
  height: number;
  wide: boolean;
} & Omit<Props, "setLang">) {
  // Screens that don't need the game state render right away.
  if (route.name === "leaderboard")
    return <Leaderboard me={pseudo} height={height} navigate={navigate} onAuthLost={onAuthLost} />;
  if (route.name === "help")
    return <Help pseudo={pseudo} navigate={navigate} onLogout={onLogout} wide={wide} />;
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
  if (!p) return <T tone={game.error ? "bad" : "dim"}>{game.error ?? "chargement…"}</T>;
  switch (route.name) {
    case "shop":
      return <Shop p={p} act={game.act} say={game.say} navigate={navigate} wide={wide} />;
    case "player":
      return (
        <PlayerBuild
          pseudo={route.pseudo}
          me={pseudo}
          mine={p.state}
          navigate={navigate}
          onAuthLost={onAuthLost}
        />
      );
    default:
      return <Dashboard p={p} act={game.act} wide={wide} height={height} />;
  }
}

function StatusBar({ game }: { game: GameData }) {
  const p = game.projection;
  if (!p) return <Text> </Text>;
  const over = p.seasonLeft === 0;
  return (
    <Text wrap="truncate">
      <Text bold>{formatMoney(p.state.money)}</Text>{" "}
      <T tone={p.rates.netPerSecond >= 0 ? "ok" : "bad"}>{formatRate(p.rates.netPerSecond)}</T>
      {"  "}score {formatMoney(p.state.revenue)}
      {"  "}
      <T tone={over ? "warn" : "dim"}>
        {over
          ? "saison terminée, la suivante arrive"
          : `fin de saison dans ${formatDuration(p.seasonLeft)}`}
      </T>
      {game.error && <T tone="bad"> {game.error}</T>}
    </Text>
  );
}

const LOG_LINES = 3;

function Log({ game }: { game: GameData }) {
  const lang = useLang();
  const lines = game.log.slice(-LOG_LINES);
  return (
    <Box
      flexDirection="column"
      height={LOG_LINES + 1}
      borderStyle="single"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor="gray"
    >
      {lines.length === 0 ? (
        <Text>
          <T tone="dim">{lang.prompt}</T> <A>_</A>
        </Text>
      ) : (
        lines.map((l) => (
          <Text key={l.id} wrap="truncate">
            <T tone="dim">{lang.prompt}</T>{" "}
            <T tone={l.tone === "err" ? "bad" : l.tone === "ok" ? undefined : "dim"}>{l.text}</T>
          </Text>
        ))
      )}
    </Box>
  );
}
