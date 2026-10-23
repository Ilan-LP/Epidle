import {
  affordableIn,
  codeLines,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRate,
  levelName,
  type Projection,
  strictnessName,
  tierName,
} from "@epidle/api-client";
import type { Act } from "@epidle/api-client/react";
import {
  BALANCE,
  type Dev,
  devLocPerSecond,
  devSalaryPerSecond,
  type GameState,
  hireCost,
  maxLevel,
  trainingPlan,
  trainingSeconds,
} from "@epidle/core";
import { Box, Text } from "ink";
import { useEffect, useMemo, useState } from "react";
import { useKeys } from "../keys";
import { Bar, Code, col, K, Panel, T, useLang } from "../ui";

interface Props {
  p: Projection;
  act: Act;
  wide: boolean;
  height: number;
}

type Pane = "company" | "pipeline";

export function Dashboard({ p, act, wide, height }: Props) {
  const training = useTrainingForm(p.state);
  const [pane, setPane] = useState<Pane>("company");
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

  useKeys({
    e: hireJunior,
    f: () => training.submit(act),
    left: () => training.moveLevel(-1),
    right: () => training.moveLevel(1),
    up: () => training.moveTarget(1),
    down: () => training.moveTarget(-1),
    tab: () => setPane((x) => (x === "company" ? "pipeline" : "company")),
    ...Object.fromEntries(BALANCE.stages.map((_, i) => [String(i + 1), () => cycleStrictness(i)])),
  });

  const company = (
    <>
      <Company p={p} />
      <Team p={p} />
      <Rooms p={p} form={training} />
    </>
  );
  const pipeline = (
    <>
      <Pipeline p={p} />
      {/* What is left of the height, if any, scrolls the code. */}
      <CodeTicker locPerSecond={p.rates.locPerSecond} lines={Math.min(8, height - 26)} />
    </>
  );

  if (wide) {
    return (
      <Box>
        <Box flexDirection="column" width="50%">
          {company}
        </Box>
        <Box flexDirection="column" width="50%">
          {pipeline}
        </Box>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text>
        <K k="tab" /> {pane === "company" ? <Text inverse>société</Text> : "société"} ·{" "}
        {pane === "pipeline" ? <Text inverse>pipeline</Text> : "pipeline"}
      </Text>
      {pane === "company" ? company : pipeline}
    </Box>
  );
}

function Company({ p }: { p: Projection }) {
  const { state: s, rates: r } = p;
  const current = BALANCE.tiers[s.tier];
  const next = BALANCE.tiers[s.tier + 1];
  const tierRatio =
    current && next ? (s.revenue - current.revenue) / (next.revenue - current.revenue) : 1;
  const tierEta =
    next && r.revenuePerSecond > 0 ? (next.revenue - s.revenue) / r.revenuePerSecond : null;
  const bugRatio = 1 - r.quality;
  const label = (t: string) => <T tone="dim">{col(t, 9)}</T>;

  return (
    <Panel title="Société">
      <Text wrap="truncate">
        {label("Argent")}
        <Text bold>{formatMoney(s.money)}</Text>{" "}
        <T tone={r.netPerSecond >= 0 ? "ok" : "bad"}>{formatRate(r.netPerSecond)}</T>
      </Text>
      <Text wrap="truncate">
        {label("")}
        <T tone="dim">
          CA {formatRate(r.revenuePerSecond)}, salaires {formatRate(-r.salaryPerSecond)}, moulis{" "}
          {formatRate(-r.upkeepPerSecond)}
        </T>
      </Text>
      <Text wrap="truncate">
        {label("Score")}
        {formatMoney(s.revenue)} <T tone="dim">CA cumulé</T>
      </Text>
      <Text wrap="truncate">
        {label("Palier")}
        {tierName(s.tier)}
        {next ? (
          <>
            <T tone="dim"> → {next.name} </T>
            <Bar ratio={tierRatio} width={12} /> {formatPercent(tierRatio)}
            {tierEta !== null && <T tone="dim"> dans {formatDuration(tierEta)}</T>}
          </>
        ) : (
          <T tone="dim"> (max)</T>
        )}
      </Text>
      <Text wrap="truncate">
        {label("Qualité")}
        <Bar ratio={r.quality} width={12} tone="ok" /> {formatPercent(r.quality)}
      </Text>
      <Text wrap="truncate">
        {label("Bugs")}
        <Bar ratio={bugRatio} width={12} tone="bad" /> {formatPercent(bugRatio)}
        <T tone="dim">
          {"  "}
          {formatNumber(r.bugsPerSecond, 1)} bugs/s livrés, {formatNumber(s.stats.bugsShipped)} au
          total
        </T>
      </Text>
    </Panel>
  );
}

function Team({ p }: { p: Projection }) {
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
  const juniorCost = hireCost(p.state, "junior");
  const wait = affordableIn(juniorCost, p.state.money, p.rates.netPerSecond);

  return (
    <Panel title={`Équipe · ${p.state.devs.length} devs`}>
      <T tone="dim">
        {col("Niveau", 11)}
        {col("Recrue", 10)}
        {col("Nb", 5, true)}
        {col("LoC/s", 9, true)}
        {col("€/s", 8, true)}
      </T>
      {groups.slice(0, 6).map((g) => (
        <Text key={`${g.level}:${g.kind}`} wrap="truncate">
          {col(levelName(g.level), 11)}
          <T tone="dim">{col(BALANCE.hire.kinds[g.kind].name, 10)}</T>
          {col(String(g.count), 4, true)}
          <T tone="warn">{g.training > 0 ? "*" : " "}</T>
          {col(formatNumber(devLocPerSecond(g.level), 1), 9, true)}
          {col(formatNumber(devSalaryPerSecond(g.level), 2), 8, true)}
        </Text>
      ))}
      {groups.length > 6 && <T tone="dim">… {groups.length - 6} autres groupes</T>}
      <Text wrap="truncate">
        <K k="e" />{" "}
        <T tone={wait === 0 ? undefined : "dim"}>Embaucher un junior : {formatMoney(juniorCost)}</T>
        {wait !== null && wait > 0 && <T tone="dim"> dans {formatDuration(wait)}</T>}
        <T tone="dim">{"  "}* en formation</T>
      </Text>
    </Panel>
  );
}

interface TrainingForm {
  /** Idle devs by level, lowest first. */
  idle: { level: number; devs: Dev[] }[];
  level: number | null;
  target: number | null;
  moveLevel: (delta: number) => void;
  moveTarget: (delta: number) => void;
  submit: (act: Act) => void;
}

/** Same rules as the web form, driven by the arrow keys. */
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
  const index = Math.max(
    0,
    idle.findIndex((g) => g.level === wantedLevel),
  );
  const level = idle[index]?.level ?? null;
  const target =
    level === null ? null : Math.min(maxLevel(), Math.max(level + 1, wantedTarget ?? level + 1));

  const moveLevel = (delta: number) => {
    const next = idle[Math.min(idle.length - 1, Math.max(0, index + delta))];
    if (next) setLevel(next.level);
  };
  const moveTarget = (delta: number) => {
    if (target !== null) setTarget(target + delta);
  };
  const submit = (act: Act) => {
    const dev = idle[index]?.devs[0];
    if (!dev || target === null) return;
    act(
      { type: "train", devId: dev.id, targetLevel: target },
      `formation #${dev.id} ${levelName(dev.level)} → ${levelName(target)}`,
    );
  };
  return { idle, level, target, moveLevel, moveTarget, submit };
}

const MAX_TRAINEES = 4;

function Rooms({ p, form }: { p: Projection; form: TrainingForm }) {
  const { state: s } = p;
  const trainees = s.devs.filter((d) => d.training);
  const free = s.rooms - trainees.length;
  const plan =
    form.level !== null && form.target !== null ? trainingPlan(form.level, form.target) : null;
  const wait = plan ? affordableIn(plan.cost, s.money, p.rates.netPerSecond) : null;
  const group = form.idle.find((g) => g.level === form.level);

  return (
    <Panel title={`Salles de formation · ${trainees.length}/${s.rooms}`}>
      {trainees.slice(0, MAX_TRAINEES).map((dev) => (
        <Trainee key={dev.id} dev={dev} time={s.time} />
      ))}
      {trainees.length > MAX_TRAINEES && (
        <T tone="dim">… {trainees.length - MAX_TRAINEES} autres en formation</T>
      )}
      {free > 0 && (
        <T tone="dim">
          [ {free} salle{free > 1 ? "s" : ""} libre{free > 1 ? "s" : ""} ]
        </T>
      )}
      {form.idle.length === 0 || form.level === null || form.target === null ? (
        <T tone="dim">Aucun dev disponible pour une formation.</T>
      ) : (
        <>
          <Text wrap="truncate">
            <K k="←→" /> dev <Text bold>{levelName(form.level)}</Text>
            <T tone="dim"> ({group?.devs.length ?? 0} dispo)</T> <K k="↑↓" /> cible{" "}
            <Text bold>{levelName(form.target)}</Text>
          </Text>
          {plan && (
            <Text wrap="truncate">
              <K k="f" />{" "}
              <T tone={free > 0 && wait === 0 ? undefined : "dim"}>
                Former : {formatMoney(plan.cost)}, {formatDuration(plan.seconds)}
              </T>
              {free <= 0 ? (
                <T tone="warn"> aucune salle libre</T>
              ) : (
                wait !== null && wait > 0 && <T tone="dim"> dans {formatDuration(wait)}</T>
              )}
            </Text>
          )}
        </>
      )}
    </Panel>
  );
}

function Trainee({ dev, time }: { dev: Dev; time: number }) {
  if (!dev.training) return null;
  const step = trainingSeconds(dev.level);
  const stepLeft = dev.training.levelEndsAt - time;
  const totalLeft = stepLeft + trainingPlan(dev.level + 1, dev.training.targetLevel).seconds;
  return (
    <Text wrap="truncate">
      #{dev.id} {levelName(dev.level)} → <Text bold>{levelName(dev.training.targetLevel)}</Text>{" "}
      <Bar ratio={1 - stepLeft / step} width={10} tone="ok" /> {levelName(dev.level + 1)} dans{" "}
      {formatDuration(stepLeft)}
      {dev.training.targetLevel > dev.level + 1 && (
        <T tone="dim">, fin dans {formatDuration(totalLeft)}</T>
      )}
    </Text>
  );
}

const NAME_WIDTH = Math.max(...BALANCE.stages.map((s) => s.name.length)) + 1;

function Pipeline({ p }: { p: Projection }) {
  const { state: s, rates: r } = p;
  let density = BALANCE.initialBugDensity;
  let ended = false;

  return (
    <Panel title="Pipeline mouli">
      <Text wrap="truncate">
        Code écrit : {formatNumber(r.locPerSecond, 1)} LoC/s,{" "}
        <T tone="bad">{formatPercent(density)} de bugs</T>
      </Text>
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

        if (locked) {
          return (
            <T key={cfg.id} tone="dim">
              {"    "}
              {col(cfg.name, NAME_WIDTH)} verrouillée (palier {tierName(cfg.tier)})
            </T>
          );
        }
        return (
          <Box key={cfg.id} flexDirection="column">
            <Text wrap="truncate">
              <K k={String(i + 1)} /> <Text bold>{col(cfg.name, NAME_WIDTH)}</Text>
              <T tone="dim">{col(`x${st.instances} v${st.version + 1}`, 8)}</T>
              <Text inverse>{strictnessName(st.strictness)}</Text>
              {strictness && (
                <T tone="dim">
                  {" "}
                  {formatPercent(strictness.catchRate)} attrapés, vitesse x
                  {formatNumber(strictness.speed, 1)}
                </T>
              )}
            </Text>
            <Text wrap="truncate">
              {"    "}
              {st.instances === 0 ? (
                <T tone="warn">
                  {wasEnded
                    ? "Aucune instance."
                    : "Aucune instance : le code part sans vérification."}
                </T>
              ) : (
                <>
                  <Bar ratio={load} width={10} tone={load > 1 ? "warn" : "ok"} />{" "}
                  {col(formatPercent(load), 6, true)} {formatNumber(flow.input, 1)} /{" "}
                  {formatNumber(flow.capacity, 1)} LoC/s
                  <T tone="dim">, bugs après : {formatPercent(density)}</T>
                </>
              )}
            </Text>
            {st.instances > 0 && overflow > 1e-9 && (
              <T tone="warn">
                {"    "}goulot : {formatNumber(overflow, 1)} LoC/s partent sans vérification
              </T>
            )}
          </Box>
        );
      })}
      <T tone="dim">
        [1-4] sévérité suivante : plus stricte attrape plus de bugs mais traite moins. Le surplus
        d'un stage saturé part sans vérification.
      </T>
    </Panel>
  );
}

/** Cosmetic: scrolls faster as the company writes more code. */
function CodeTicker({ locPerSecond, lines: visible }: { locPerSecond: number; lines: number }) {
  const lang = useLang();
  const lines = useMemo(() => codeLines(lang), [lang]);
  const [pos, setPos] = useState(0);
  const linesPerSecond = Math.min(10, 0.5 + Math.log2(1 + locPerSecond) / 2);
  const moving = locPerSecond > 0 && visible > 0;

  useEffect(() => {
    if (!moving) return;
    const id = setInterval(() => setPos((n) => n + 1), 1000 / linesPerSecond);
    return () => clearInterval(id);
  }, [moving, linesPerSecond]);

  if (visible <= 0) return null;
  const shown = Array.from({ length: visible }, (_, i) => pos + i);
  return (
    <Panel title={`${lang.file} · ${formatNumber(locPerSecond, 1)} LoC/s`}>
      {shown.map((n) => (
        <Box key={n}>
          <T tone="dim">{String(n + 1).padStart(4)} </T>
          <Code line={lines[n % lines.length] ?? ""} />
        </Box>
      ))}
    </Panel>
  );
}
