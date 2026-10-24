import {
  awardText,
  effectsText,
  feedText,
  feedTime,
  formatMoney,
  type Scope,
} from "@epidle/api-client";
import { usePolled } from "@epidle/api-client/react";
import { Box, Text, useWindowSize } from "ink";
import { useState } from "react";
import type { Navigate } from "../Game";
import { useClient } from "../hooks";
import { useKeys } from "../keys";
import { col, K, Panel, T } from "../ui";

const SCOPES: { id: Scope; label: string }[] = [
  { id: "season", label: "Saison" },
  { id: "alltime", label: "Général" },
];

/** Lines of the screen that are not table rows. */
const CHROME = 8;

/** Width of the ranking when the weekly feed sits next to it. */
const BOARD_WIDTH = 44;

export function Leaderboard({
  me,
  height,
  wide,
  navigate,
  onAuthLost,
}: {
  me: string;
  height: number;
  wide: boolean;
  navigate: Navigate;
  onAuthLost: () => void;
}) {
  const { api } = useClient();
  const { columns } = useWindowSize();
  const [scope, setScope] = useState<Scope>("season");
  const [cursor, setCursor] = useState(0);
  const { data, error } = usePolled(() => api.leaderboard(scope), scope, 30_000, onAuthLost);
  const entries = data?.entries ?? [];
  const selected = Math.min(cursor, Math.max(0, entries.length - 1));
  const move = (delta: number) =>
    setCursor(Math.min(Math.max(0, entries.length - 1), Math.max(0, selected + delta)));

  useKeys({
    v: () => {
      setScope((s) => (s === "season" ? "alltime" : "season"));
      setCursor(0);
    },
    up: () => move(-1),
    k: () => move(-1),
    down: () => move(1),
    j: () => move(1),
    return: () => {
      const e = entries[selected];
      if (e) navigate({ name: "player", pseudo: e.pseudo });
    },
    escape: () => navigate({ name: "dashboard" }),
  });

  // Keep the selected row in view.
  const visible = Math.max(3, height - CHROME);
  const first = Math.min(
    Math.max(0, selected - visible + 1),
    Math.max(0, entries.length - visible),
  );
  const shown = entries.slice(first, first + visible);

  const board = (
    <Panel
      title={data ? `Classement · saison ${data.season.id}` : "Classement"}
      width={wide ? BOARD_WIDTH : undefined}
    >
      <Text>
        <K k="v" />{" "}
        {SCOPES.map((s) => (
          <Text key={s.id}>
            {s.id === scope ? <Text inverse>{s.label}</Text> : <T tone="dim">{s.label}</T>}{" "}
          </Text>
        ))}
      </Text>
      {error && <T tone="bad">{error}</T>}
      {!data && !error && <T tone="dim">chargement…</T>}
      {data && (
        <>
          <Text>
            {data.me ? (
              <>
                Toi : <Text bold>#{data.me.rank}</Text>, {formatMoney(data.me.score)}
              </>
            ) : (
              <T tone="dim">Pas encore classé.</T>
            )}
          </Text>
          {entries.length === 0 ? (
            <T tone="dim">Personne pour l'instant.</T>
          ) : (
            <Box flexDirection="column">
              <T tone="dim">
                {"  "}
                {col("#", 5, true)} {col("Pseudo", 17)}
                {col("Score", 14, true)}
                {"  Titre"}
              </T>
              {shown.map((e, i) => {
                const isSelected = first + i === selected;
                const title = e.title ? `  ${awardText(e.title)}` : "";
                const line = `${col(String(e.rank), 5, true)} ${col(e.pseudo, 17)}${col(formatMoney(e.score), 14, true)}${title}`;
                return (
                  <Text key={e.pseudo} wrap="truncate">
                    {isSelected ? <Text bold>› </Text> : "  "}
                    {isSelected ? (
                      <Text inverse>{line}</Text>
                    ) : e.pseudo === me ? (
                      <Text bold>{line}</Text>
                    ) : (
                      line
                    )}
                  </Text>
                );
              })}
            </Box>
          )}
          <T tone="dim">
            {scope === "season"
              ? "Score = CA cumulé de la saison, mis à jour chaque minute."
              : "Somme des scores de toutes les saisons."}{" "}
            [↑↓] choisir · [Entrée] voir son build · [Échap] retour
          </T>
        </>
      )}
    </Panel>
  );
  // Narrow terminals: the feed goes below, PgDn reaches it. An explicit width: Ink measures
  // wrapped text wrong in a growing box, and lines of the description got lost.
  return wide ? (
    <Box>
      {board}
      <WeekFeed height={height} width={columns - 2 - BOARD_WIDTH} onAuthLost={onAuthLost} />
    </Box>
  ) : (
    <>
      {board}
      <Text> </Text>
      <WeekFeed onAuthLost={onAuthLost} />
    </>
  );
}

/** What changed this week: what people talk about next to the ranking. */
/** `height`: fit the events in it (side by side). Without it, all of them (below, scrolling). */
function WeekFeed({
  height,
  width,
  onAuthLost,
}: {
  height?: number;
  width?: number;
  onAuthLost: () => void;
}) {
  const { api } = useClient();
  const { data, error } = usePolled(() => api.feed(), "feed", 30_000, onAuthLost);
  const title = data?.week.modifier
    ? `Cette semaine · ${data.week.modifier.name}`
    : "Cette semaine";
  const climbers = data?.climbers ?? [];
  // Title, description (up to 3 lines), summary and the two headings.
  const room =
    height === undefined
      ? undefined
      : Math.max(3, height - 8 - (climbers.length ? climbers.length + 1 : 0));
  return (
    <Panel title={title} width={width}>
      {error && <T tone="bad">{error}</T>}
      {!data && !error && <T tone="dim">chargement…</T>}
      {data && (
        <>
          {data.week.modifier && (
            <Text>
              {data.week.modifier.description}{" "}
              <T tone="dim">({effectsText(data.week.modifier.effects)})</T>
            </Text>
          )}
          <T tone="dim">
            {data.players} joueur{data.players > 1 ? "s" : ""} cette saison, {data.joined} arrivé
            {data.joined > 1 ? "s" : ""} cette semaine.
          </T>
          {climbers.length > 0 && (
            <>
              <Text bold>Plus fortes progressions</Text>
              {climbers.map((c, i) => (
                <Text key={c.pseudo} wrap="truncate">
                  {col(String(i + 1), 3, true)} {col(c.pseudo, 17)}
                  <T tone="ok">+{formatMoney(c.gain)}</T>
                </Text>
              ))}
            </>
          )}
          <Text bold>Fil</Text>
          {data.events.length === 0 ? (
            <T tone="dim">
              Rien pour l'instant : paliers, premiers devs Lead et plus, changements de tête.
            </T>
          ) : (
            data.events.slice(0, room).map((e) => (
              <Text key={`${e.at}:${e.kind}:${e.pseudo}:${e.value}`} wrap="truncate">
                <T tone="dim">{feedTime(e.at)}</T> {feedText(e)}
              </Text>
            ))
          )}
        </>
      )}
    </Panel>
  );
}
