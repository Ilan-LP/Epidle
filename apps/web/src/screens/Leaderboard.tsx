import { formatMoney, type Scope } from "@epidle/api-client";
import { useState } from "react";
import { api } from "../api";
import { usePolled } from "../hooks";
import { useShortcuts } from "../keys";
import { href, navigate } from "../router";
import { Btn, Panel } from "../ui";

const SCOPES: { id: Scope; label: string }[] = [
  { id: "season", label: "Saison" },
  { id: "alltime", label: "Général" },
];

export function Leaderboard({ me, onAuthLost }: { me: string; onAuthLost: () => void }) {
  const [scope, setScope] = useState<Scope>("season");
  const { data, error } = usePolled(() => api.leaderboard(scope), scope, 30_000, onAuthLost);
  const other = () => setScope((s) => (s === "season" ? "alltime" : "season"));
  useShortcuts({ v: other, escape: () => navigate({ name: "dashboard" }) });

  return (
    <div className="grid">
      <Panel title={data ? `Classement · saison ${data.season.id}` : "Classement"} wide>
        <p>
          {SCOPES.map((s, i) => (
            <Btn
              key={s.id}
              active={s.id === scope}
              onClick={() => setScope(s.id)}
              hint={i === 0 ? "v" : undefined}
            >
              {s.label}
            </Btn>
          ))}
        </p>
        {error && <p className="bad">{error}</p>}
        {!data && !error && <p className="dim">chargement…</p>}
        {data && (
          <>
            <p>
              {data.me ? (
                <>
                  Toi : <strong>#{data.me.rank}</strong>, {formatMoney(data.me.score)}
                </>
              ) : (
                <span className="dim">Pas encore classé.</span>
              )}
            </p>
            {data.entries.length === 0 ? (
              <p className="dim">Personne pour l'instant.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>Pseudo</th>
                    <th className="num">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.pseudo} className={e.pseudo === me ? "me" : undefined}>
                      <td className="num">{e.rank}</td>
                      <td>
                        <a href={href({ name: "player", pseudo: e.pseudo })}>{e.pseudo}</a>
                      </td>
                      <td className="num">{formatMoney(e.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="dim small">
              {scope === "season"
                ? "Score = CA cumulé de la saison, mis à jour toutes les 30 s."
                : "Somme des scores de toutes les saisons."}{" "}
              Clique un pseudo pour voir son build.
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
