import {
  affordableIn,
  codeLines,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRate,
  type Language,
  type Projection,
  shareText,
} from "@epidle/api-client";
import {
  BALANCE,
  type Balance,
  type Dev,
  devLocPerSecond,
  devSalaryPerSecond,
  type GameState,
  hireCost,
  maxLevel,
  trainingPlan,
  trainingSeconds,
} from "@epidle/core";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { copyText } from "../clipboard";
import type { Act, Game } from "../hooks";
import { usePrefersReducedMotion } from "../hooks";
import { useShortcuts } from "../keys";
import { Bar, Btn, Code, Key, levelName, Panel, strictnessName, tierName } from "../ui";

interface Props {
  p: Projection;
  act: Act;
  say: Game["say"];
  lang: Language;
  pseudo: string;
}

/** Copies the Discord snapshot of the build. The rank is fetched at that moment. */
async function copyBuild(p: Projection, pseudo: string, say: Game["say"]) {
  const rank = await api.leaderboard("season").then(
    (b) => b.me?.rank ?? null,
    () => null,
  );
  const text = shareText({ pseudo, p, rank, webUrl: window.location.origin });
  if (await copyText(text)) say("ok", "build copié, colle-le sur Discord");
  else say("err", "copie impossible : le navigateur l'a refusée");
}

export function Dashboard({ p, act, say, lang, pseudo }: Props) {
  const training = useTrainingForm(p.state);
  const juniorCost = hireCost(p.state, "junior", p.cfg);
  const hireJunior = () => act({ type: "hire", kind: "junior" }, "embauche Junior");
  const cycleStrictness = (i: number) => {
    const stage = BALANCE.stages[i];
    const s = p.state.stages[i];
    if (!stage || !s || p.state.tier < stage.tier) return;
    const level = (s.strictness + 1) % BALANCE.strictness.length;
    act(
      { type: "setStrictness", stage: stage.id, level },
      `${stage.name} : ${strictnessName(level)}`,
    );
  };

  const share = () => copyBuild(p, pseudo, say);

  useShortcuts({
    y: share,
    e: hireJunior,
    f: () => training.submit(act),
    ...Object.fromEntries(BALANCE.stages.map((_, i) => [String(i + 1), () => cycleStrictness(i)])),
  });

  return (
    <div className="grid">
      <Company p={p} onShare={share} />
      <CodeTicker lang={lang} locPerSecond={p.rates.locPerSecond} />
      <Team p={p} juniorCost={juniorCost} onHire={hireJunior} />
      <Rooms p={p} form={training} act={act} />
      <Pipeline p={p} act={act} />
    </div>
  );
}

function Company({ p, onShare }: { p: Projection; onShare: () => void }) {
  const { state: s, rates: r } = p;
  const current = BALANCE.tiers[s.tier];
  const next = BALANCE.tiers[s.tier + 1];
  const tierRatio =
    current && next ? (s.revenue - current.revenue) / (next.revenue - current.revenue) : 1;
  const tierEta =
    next && r.revenuePerSecond > 0 ? (next.revenue - s.revenue) / r.revenuePerSecond : null;
  const bugRatio = 1 - r.quality;

  return (
    <Panel title="Société">
      <dl className="kv">
        <dt>Argent</dt>
        <dd>
          <strong>{formatMoney(s.money)}</strong>{" "}
          <span className={r.netPerSecond >= 0 ? "ok" : "bad"}>{formatRate(r.netPerSecond)}</span>
        </dd>
        <dt>Détail</dt>
        <dd className="dim">
          CA {formatRate(r.revenuePerSecond)}, salaires {formatRate(-r.salaryPerSecond)}, moulis{" "}
          {formatRate(-r.upkeepPerSecond)}
        </dd>
        <dt>Score</dt>
        <dd>
          {formatMoney(s.revenue)} <span className="dim">CA cumulé</span>
        </dd>
        <dt>Palier</dt>
        <dd>
          {tierName(s.tier)}
          {next ? (
            <>
              {" "}
              <span className="dim">→ {next.name}</span>
              <br />
              <Bar ratio={tierRatio} /> {formatPercent(tierRatio)}
              {tierEta !== null && <span className="dim"> dans {formatDuration(tierEta)}</span>}
            </>
          ) : (
            <span className="dim"> (max)</span>
          )}
        </dd>
        <dt>Qualité</dt>
        <dd>
          <Bar ratio={r.quality} tone="ok" /> {formatPercent(r.quality)}
        </dd>
        <dt>Bugs</dt>
        <dd>
          <Bar ratio={bugRatio} tone="bad" /> {formatPercent(bugRatio)}
          <br />
          <span className="dim">
            {formatNumber(r.bugsPerSecond, 1)} bugs/s livrés, {formatNumber(s.stats.bugsShipped)} au
            total
          </span>
        </dd>
      </dl>
      <p>
        <Btn hint="y" onClick={onShare} title="Résumé texte de ton build, à coller sur Discord">
          Copier mon build
        </Btn>
      </p>
    </Panel>
  );
}

const VISIBLE_LINES = 7;

/** Cosmetic: scrolls faster as the company writes more code. */
function CodeTicker({ lang, locPerSecond }: { lang: Language; locPerSecond: number }) {
  const lines = useMemo(() => codeLines(lang), [lang]);
  const reduced = usePrefersReducedMotion();
  const [pos, setPos] = useState(VISIBLE_LINES);
  const linesPerSecond = Math.min(10, 0.5 + Math.log2(1 + locPerSecond) / 2);
  const moving = !reduced && locPerSecond > 0;

  useEffect(() => {
    if (!moving) return;
    const id = setInterval(() => setPos((n) => n + 1), 1000 / linesPerSecond);
    return () => clearInterval(id);
  }, [moving, linesPerSecond]);

  const shown = Array.from({ length: VISIBLE_LINES }, (_, i) => pos - VISIBLE_LINES + i);
  return (
    <Panel title={`${lang.file} · ${formatNumber(locPerSecond, 1)} LoC/s`}>
      <pre className="code" aria-hidden="true">
        {shown.map((n) => (
          <div key={n}>
            <span className="gutter">{String(n + 1).padStart(4)} </span>
            <Code line={lines[n % lines.length] ?? ""} lang={lang} />
          </div>
        ))}
      </pre>
    </Panel>
  );
}

function Team({
  p,
  juniorCost,
  onHire,
}: {
  p: Projection;
  juniorCost: number;
  onHire: () => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { kind: Dev["kind"]; level: number; count: number; training: number }
    >();
    for (const dev of p.state.devs) {
      const key = `${dev.level}:${dev.kind}`;
      const g = map.get(key) ?? { kind: dev.kind, level: dev.level, count: 0, training: 0 };
      g.count++;
      if (dev.training) g.training++;
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.level - a.level || a.kind.localeCompare(b.kind));
  }, [p.state.devs]);
  const wait = affordableIn(juniorCost, p.state.money, p.rates.netPerSecond);

  return (
    <Panel title={`Équipe · ${p.state.devs.length} devs`}>
      <table className="table">
        <thead>
          <tr>
            <th>Niveau</th>
            <th>Recrue</th>
            <th className="num">Nb</th>
            <th className="num">LoC/s</th>
            <th className="num">€/s</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={`${g.level}:${g.kind}`}>
              <td>{levelName(g.level)}</td>
              <td className="dim">{BALANCE.hire.kinds[g.kind].name}</td>
              <td className="num">
                {g.count}
                {g.training > 0 && (
                  <span className="warn" title={`${g.training} en formation`}>
                    *
                  </span>
                )}
              </td>
              <td className="num">{formatNumber(devLocPerSecond(g.level, p.cfg), 1)}</td>
              <td className="num">{formatNumber(devSalaryPerSecond(g.level, p.cfg), 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dim small">* en formation : payé, mais n'écrit pas de code.</p>
      <p>
        <Btn hint="e" onClick={onHire} disabled={wait !== 0}>
          Embaucher un junior : {formatMoney(juniorCost)}
        </Btn>
        {wait !== null && wait > 0 && <span className="dim"> dans {formatDuration(wait)}</span>}
      </p>
    </Panel>
  );
}

interface TrainingForm {
  /** Idle devs by level, lowest first. */
  idle: { level: number; devs: Dev[] }[];
  level: number | null;
  target: number | null;
  setLevel: (level: number) => void;
  setTarget: (level: number) => void;
  submit: (act: Act) => void;
}

function useTrainingForm(state: GameState): TrainingForm {
  const idle = useMemo(() => {
    const map = new Map<number, Dev[]>();
    for (const dev of state.devs) {
      if (dev.training || dev.level >= maxLevel()) continue;
      map.set(dev.level, [...(map.get(dev.level) ?? []), dev]);
    }
    return [...map.entries()].sort(([a], [b]) => a - b).map(([level, devs]) => ({ level, devs }));
  }, [state.devs]);
  const [wantedLevel, setLevel] = useState<number | null>(null);
  const [wantedTarget, setTarget] = useState<number | null>(null);

  // Fall back to valid choices when the team changes under the selection.
  const level = idle.find((g) => g.level === wantedLevel)?.level ?? idle[0]?.level ?? null;
  const target =
    level === null ? null : Math.min(maxLevel(), Math.max(level + 1, wantedTarget ?? level + 1));

  const submit = (act: Act) => {
    const dev = idle.find((g) => g.level === level)?.devs[0];
    if (!dev || target === null) return;
    act(
      { type: "train", devId: dev.id, targetLevel: target },
      `formation #${dev.id} ${levelName(dev.level)} → ${levelName(target)}`,
    );
  };
  return { idle, level, target, setLevel, setTarget, submit };
}

function Rooms({ p, form, act }: { p: Projection; form: TrainingForm; act: Act }) {
  const { state: s } = p;
  const trainees = s.devs.filter((d) => d.training);
  const free = s.rooms - trainees.length;
  const plan =
    form.level !== null && form.target !== null
      ? trainingPlan(form.level, form.target, p.cfg)
      : null;
  const wait = plan ? affordableIn(plan.cost, s.money, p.rates.netPerSecond) : null;

  return (
    <Panel title={`Salles de formation · ${trainees.length}/${s.rooms}`}>
      <ul className="list">
        {trainees.map((dev) => (
          <Trainee key={dev.id} dev={dev} time={s.time} cfg={p.cfg} />
        ))}
        {Array.from({ length: Math.max(0, free) }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders
          <li key={i} className="dim">
            [ salle libre ]
          </li>
        ))}
      </ul>
      {form.idle.length === 0 ? (
        <p className="dim">Aucun dev disponible pour une formation.</p>
      ) : (
        <div className="form">
          <label>
            Dev{" "}
            <select
              value={form.level ?? ""}
              onChange={(e) => form.setLevel(Number(e.target.value))}
            >
              {form.idle.map((g) => (
                <option key={g.level} value={g.level}>
                  {levelName(g.level)} ({g.devs.length} dispo)
                </option>
              ))}
            </select>
          </label>{" "}
          <label>
            → cible{" "}
            <select
              value={form.target ?? ""}
              onChange={(e) => form.setTarget(Number(e.target.value))}
            >
              {form.level !== null &&
                BALANCE.levels.slice(form.level + 1).map((name, i) => {
                  const lvl = (form.level as number) + 1 + i;
                  return (
                    <option key={lvl} value={lvl}>
                      {name}
                    </option>
                  );
                })}
            </select>
          </label>
          {plan && (
            <p>
              <Btn hint="f" onClick={() => form.submit(act)} disabled={free <= 0 || wait !== 0}>
                Former : {formatMoney(plan.cost)}, {formatDuration(plan.seconds)}
              </Btn>
              {free <= 0 ? (
                <span className="warn"> aucune salle libre</span>
              ) : (
                wait !== null &&
                wait > 0 && <span className="dim"> dans {formatDuration(wait)}</span>
              )}
            </p>
          )}
          <p className="dim small">
            Chaque niveau double la production et la durée. Le dev reste en salle jusqu'à la cible.
          </p>
        </div>
      )}
    </Panel>
  );
}

function Trainee({ dev, time, cfg }: { dev: Dev; time: number; cfg: Balance }) {
  if (!dev.training) return null;
  const step = trainingSeconds(dev.level, cfg);
  const stepLeft = dev.training.levelEndsAt - time;
  // The levels after this one follow this week's balance: an estimate if the week changes.
  const totalLeft = stepLeft + trainingPlan(dev.level + 1, dev.training.targetLevel, cfg).seconds;
  return (
    <li>
      #{dev.id} {levelName(dev.level)} → <strong>{levelName(dev.training.targetLevel)}</strong>
      <br />
      <Bar ratio={1 - stepLeft / step} width={12} tone="ok" /> {levelName(dev.level + 1)} dans{" "}
      {formatDuration(stepLeft)}
      {dev.training.targetLevel > dev.level + 1 && (
        <span className="dim">, fin dans {formatDuration(totalLeft)}</span>
      )}
    </li>
  );
}

function Pipeline({ p, act }: { p: Projection; act: Act }) {
  const { state: s, rates: r } = p;
  let density = BALANCE.initialBugDensity;
  let ended = false;

  return (
    <Panel title="Pipeline mouli" wide>
      <p>
        Code écrit : {formatNumber(r.locPerSecond, 1)} LoC/s,{" "}
        <span className="bad">{formatPercent(density)} de bugs</span>
      </p>
      <ol className="stages">
        {BALANCE.stages.map((cfg, i) => {
          const st = s.stages[i];
          const flow = r.stages[i];
          if (!st || !flow) return null;
          const locked = s.tier < cfg.tier;
          const strictness = BALANCE.strictness[st.strictness];
          const wasEnded = ended;
          if (!locked && st.instances > 0 && strictness && !ended)
            density *= 1 - strictness.catchRate;
          if (locked || st.instances === 0) ended = true;
          const load = flow.capacity > 0 ? flow.input / flow.capacity : 0;
          const overflow = flow.input - flow.processed;

          return (
            <li key={cfg.id} className={locked ? "dim" : undefined}>
              <div>
                {!locked && <Key k={String(i + 1)} />}
                <strong>{cfg.name}</strong>{" "}
                {locked ? (
                  <span>verrouillée (palier {tierName(cfg.tier)})</span>
                ) : (
                  <span className="dim">
                    x{st.instances} v{st.version + 1}
                  </span>
                )}
              </div>
              {!locked && (
                <>
                  <div className="strictness">
                    {BALANCE.strictness.map((level, l) => (
                      <Btn
                        key={level.name}
                        active={l === st.strictness}
                        title={`${Math.round(level.catchRate * 100)} % des bugs attrapés, vitesse x${level.speed}`}
                        onClick={() =>
                          l !== st.strictness &&
                          act(
                            { type: "setStrictness", stage: cfg.id, level: l },
                            `${cfg.name} : ${level.name}`,
                          )
                        }
                      >
                        {level.name}
                      </Btn>
                    ))}
                  </div>
                  {st.instances === 0 ? (
                    <div className="warn">
                      {wasEnded
                        ? "Aucune instance."
                        : "Aucune instance : le code part sans cette vérification."}
                    </div>
                  ) : (
                    <>
                      <div>
                        flux {formatNumber(flow.input, 1)} / capacité{" "}
                        {formatNumber(flow.capacity, 1)} LoC/s
                      </div>
                      <div>
                        <Bar ratio={load} tone={load > 1 ? "warn" : "ok"} /> {formatPercent(load)}
                      </div>
                      {overflow > 1e-9 && (
                        <div className="warn">
                          goulot : {formatNumber(overflow, 1)} LoC/s partent sans vérification
                        </div>
                      )}
                      <div className="dim">bugs après ce stage : {formatPercent(density)}</div>
                    </>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>
      <p className="dim small">
        Plus stricte = plus de bugs attrapés mais moins de débit. Le surplus d'un stage saturé est
        livré tel quel. <span className="key-help">[1-4] change la sévérité d'un stage.</span>
      </p>
    </Panel>
  );
}
