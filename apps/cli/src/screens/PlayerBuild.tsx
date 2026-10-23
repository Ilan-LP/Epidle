import {
  type PlayerBuild as Build,
  formatMoney,
  levelName,
  strictnessName,
  tierName,
} from "@epidle/api-client";
import { usePolled } from "@epidle/api-client/react";
import { BALANCE, type GameState } from "@epidle/core";
import { Box, Text } from "ink";
import type { Navigate } from "../Game";
import { useClient } from "../hooks";
import { useKeys } from "../keys";
import { A, col, Panel, T } from "../ui";

/** Another player's strategy next to yours, to compare and discuss. */
export function PlayerBuild({
  pseudo,
  me,
  mine,
  navigate,
  onAuthLost,
}: {
  pseudo: string;
  me: string;
  mine: GameState;
  navigate: Navigate;
  onAuthLost: () => void;
}) {
  const { api, server } = useClient();
  const { data, error } = usePolled(() => api.build(pseudo), pseudo, 60_000, onAuthLost);
  useKeys({ escape: () => navigate({ name: "leaderboard" }) });
  const self = pseudo.toLowerCase() === me.toLowerCase();

  return (
    <Panel title={`Build de ${pseudo}${self ? " (toi)" : ""}`}>
      {error && (
        <T tone="bad">
          {error === "Introuvable." ? "Ce joueur n'a pas joué cette saison." : error}
        </T>
      )}
      {!data && !error && <T tone="dim">chargement…</T>}
      {data && <Comparison build={data} mine={mine} self={self} />}
      <Text wrap="truncate">
        <T tone="dim">Lien à partager : </T>
        <A>
          {server}/#/joueur/{encodeURIComponent(pseudo)}
        </A>
      </Text>
      <T tone="dim">[Échap] classement</T>
    </Panel>
  );
}

function Comparison({ build, mine, self }: { build: Build; mine: GameState; self: boolean }) {
  const myTraining = mine.devs.filter((d) => d.training).length;
  const rows: [string, string, string][] = [
    ["Palier", tierName(build.tier), tierName(mine.tier)],
    ["Score", formatMoney(build.score), formatMoney(mine.revenue)],
    ["Effectif", String(build.headcount), String(mine.devs.length)],
    ["En formation", String(build.team.reduce((n, g) => n + g.training, 0)), String(myTraining)],
    ["Salles", String(build.rooms), String(mine.rooms)],
    ...BALANCE.stages.map((cfg, i): [string, string, string] => {
      const show = (s: { instances: number; version: number; strictness: number } | undefined) =>
        s && s.instances > 0
          ? `x${s.instances} v${s.version + 1} ${strictnessName(s.strictness)}`
          : "-";
      return [cfg.name, show(build.stages[i]), show(mine.stages[i])];
    }),
  ];

  return (
    <Box flexDirection="column">
      <Text bold>
        {col("", 16)}
        {col(build.pseudo, 22)}
        {!self && "toi"}
      </Text>
      {rows.map(([label, theirs, ours]) => (
        <Text key={label} wrap="truncate">
          <T tone="dim">{col(label, 16)}</T>
          {col(theirs, 22)}
          {!self && <T tone="dim">{ours}</T>}
        </Text>
      ))}
      <Text> </Text>
      <Text bold>Équipe</Text>
      <T tone="dim">
        {col("Niveau", 11)}
        {col("Recrue", 10)}
        {col("Nb", 5, true)}
        {col("En formation", 14, true)}
      </T>
      {build.team.map((g) => (
        <Text key={`${g.level}:${g.kind}`} wrap="truncate">
          {col(levelName(g.level), 11)}
          <T tone="dim">{col(BALANCE.hire.kinds[g.kind]?.name ?? g.kind, 10)}</T>
          {col(String(g.count), 5, true)}
          {col(g.training ? String(g.training) : "", 14, true)}
        </Text>
      ))}
      <T tone="dim">L'argent en banque reste privé.</T>
    </Box>
  );
}
