import {
  awardText,
  effectsText,
  feedText,
  feedTime,
  formatMoney,
  type Scope,
} from "@epidle/api-client";
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
      <Panel title={data ? `Classement · saison ${data.season.id}` : "Classement"}>
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
                        {e.title && <span className="dim small"> {awardText(e.title)}</span>}
                      </td>
                      <td className="num">{formatMoney(e.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="dim small">
              {scope === "season"
                ? "Score = CA cumulé de la saison, mis à jour chaque minute."
                : "Somme des scores de toutes les saisons."}{" "}
              Clique un pseudo pour voir son build.
            </p>
          </>
        )}
      </Panel>
      <WeekFeed onAuthLost={onAuthLost} />
    </div>
  );
}

/** What changed this week: what people talk about next to the ranking. */
function WeekFeed({ onAuthLost }: { onAuthLost: () => void }) {
  const { data, error } = usePolled(() => api.feed(), "feed", 30_000, onAuthLost);
  const title = data
    ? `Cette semaine${data.week.modifier ? ` · ${data.week.modifier.name}` : ""}`
    : "Cette semaine";
  return (
    <Panel title={title}>
      {error && <p className="bad">{error}</p>}
      {!data && !error && <p className="dim">chargement…</p>}
      {data && (
        <>
          {data.week.modifier && (
            <p>
              {data.week.modifier.description}{" "}
              <span className="dim">({effectsText(data.week.modifier.effects)})</span>
            </p>
          )}
          <p className="dim">
            {data.players} joueur{data.players > 1 ? "s" : ""} cette saison, {data.joined} arrivé
            {data.joined > 1 ? "s" : ""} cette semaine.
          </p>
          {data.climbers.length > 0 && (
            <>
              <h3>Plus fortes progressions</h3>
              <table className="table">
                <tbody>
                  {data.climbers.map((c, i) => (
                    <tr key={c.pseudo}>
                      <td className="num">{i + 1}</td>
                      <td>
                        <a href={href({ name: "player", pseudo: c.pseudo })}>{c.pseudo}</a>
                      </td>
                      <td className="num ok">+{formatMoney(c.gain)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <h3>Fil</h3>
          {data.events.length === 0 ? (
            <p className="dim">
              Rien pour l'instant. Les paliers, les premiers devs Lead et plus, et les changements
              de tête s'affichent ici.
            </p>
          ) : (
            <ul className="feed">
              {data.events.map((e) => (
                <li key={`${e.at}:${e.kind}:${e.pseudo}:${e.value}`}>
                  <time dateTime={new Date(e.at).toISOString()}>{feedTime(e.at)}</time>
                  {feedText(e)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
