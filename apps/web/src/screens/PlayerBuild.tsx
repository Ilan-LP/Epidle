import { awardText, type PlayerBuild as Build, formatMoney } from "@epidle/api-client";
import { BALANCE, type GameState } from "@epidle/core";
import { useState } from "react";
import { api } from "../api";
import { usePolled } from "../hooks";
import { useShortcuts } from "../keys";
import { navigate } from "../router";
import { Btn, levelName, Panel, strictnessName, tierName } from "../ui";

/** Another player's strategy next to yours, to compare and discuss. */
export function PlayerBuild({
  pseudo,
  me,
  mine,
  onAuthLost,
}: {
  pseudo: string;
  me: string;
  mine: GameState;
  onAuthLost: () => void;
}) {
  const { data, error } = usePolled(() => api.build(pseudo), pseudo, 60_000, onAuthLost);
  const [copied, setCopied] = useState(false);
  useShortcuts({ escape: () => navigate({ name: "leaderboard" }) });
  const self = pseudo.toLowerCase() === me.toLowerCase();

  const copy = () => {
    navigator.clipboard?.writeText(window.location.href).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <div className="grid">
      <Panel title={`Build de ${pseudo}${self ? " (toi)" : ""}`} wide>
        <p>
          <Btn hint="Esc" onClick={() => navigate({ name: "leaderboard" })}>
            Classement
          </Btn>{" "}
          <Btn onClick={copy}>{copied ? "Lien copié" : "Copier le lien"}</Btn>
        </p>
        {error && (
          <p className="bad">
            {error === "Introuvable." ? "Ce joueur n'a pas joué cette saison." : error}
          </p>
        )}
        {!data && !error && <p className="dim">chargement…</p>}
        {data && <Comparison build={data} mine={mine} self={self} />}
      </Panel>
    </div>
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
      const theirs = build.stages[i];
      const ours = mine.stages[i];
      const show = (s: { instances: number; version: number; strictness: number } | undefined) =>
        s && s.instances > 0
          ? `x${s.instances} v${s.version + 1} ${strictnessName(s.strictness)}`
          : "-";
      return [cfg.name, show(theirs), show(ours)];
    }),
  ];

  return (
    <>
      <table className="table compare">
        <thead>
          <tr>
            <th />
            <th>{build.pseudo}</th>
            {!self && <th>toi</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, theirs, ours]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{theirs}</td>
              {!self && <td className="dim">{ours}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Équipe</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Niveau</th>
            <th>Recrue</th>
            <th className="num">Nb</th>
            <th className="num">En formation</th>
          </tr>
        </thead>
        <tbody>
          {build.team.map((g) => (
            <tr key={`${g.level}:${g.kind}`}>
              <td>{levelName(g.level)}</td>
              <td className="dim">{BALANCE.hire.kinds[g.kind]?.name ?? g.kind}</td>
              <td className="num">{g.count}</td>
              <td className="num">{g.training || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Badges</h3>
      <p className={build.badges.length ? undefined : "dim"}>
        {build.badges.length ? build.badges.map(awardText).join(" · ") : "Aucun pour l'instant."}
      </p>
      <p className="dim small">L'argent en banque reste privé.</p>
    </>
  );
}
