import { formatMoney, type Scope } from "@epidle/api-client";
import { usePolled } from "@epidle/api-client/react";
import { Box, Text } from "ink";
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

export function Leaderboard({
  me,
  height,
  navigate,
  onAuthLost,
}: {
  me: string;
  height: number;
  navigate: Navigate;
  onAuthLost: () => void;
}) {
  const { api } = useClient();
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

  return (
    <Panel title={data ? `Classement · saison ${data.season.id}` : "Classement"}>
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
              </T>
              {shown.map((e, i) => {
                const isSelected = first + i === selected;
                const line = `${col(String(e.rank), 5, true)} ${col(e.pseudo, 17)}${col(formatMoney(e.score), 14, true)}`;
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
              ? "Score = CA cumulé de la saison, mis à jour toutes les 30 s."
              : "Somme des scores de toutes les saisons."}{" "}
            [↑↓] choisir · [Entrée] voir son build · [Échap] retour
          </T>
        </>
      )}
    </Panel>
  );
}
