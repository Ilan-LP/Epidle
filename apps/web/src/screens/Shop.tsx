import {
  affordableIn,
  formatDuration,
  formatMoney,
  hireItem,
  maxAffordable,
  mouliItem,
  type Projection,
  quote,
  roomItem,
  type ShopItem,
  upgradeItem,
} from "@epidle/api-client";
import { BALANCE, type GameState, INTENT_ERROR_MESSAGES, type IntentError } from "@epidle/core";
import { useState } from "react";
import type { Act } from "../hooks";
import { useShortcuts } from "../keys";
import { navigate } from "../router";
import { Btn, Panel, tierName } from "../ui";

const MODES = [1, 10, 100, "max"] as const;
type Mode = (typeof MODES)[number];
/** Server limit for one intent. */
const MAX_COUNT = 100;

interface Row {
  hint: string;
  item: ShopItem;
  /** Shown in the log. */
  name: string;
  /** Tier required, to explain a lock. */
  tier: number;
}

function rows(): { title: string; rows: Row[] }[] {
  return [
    {
      title: "Recrutement",
      rows: (["junior", "confirme", "senior"] as const).map((kind, i) => ({
        hint: String(i + 1),
        item: hireItem(kind),
        name: `embauche ${BALANCE.hire.kinds[kind].name}`,
        tier: BALANCE.hire.kinds[kind].tier,
      })),
    },
    {
      title: "Formation",
      rows: [{ hint: "4", item: roomItem, name: "achat salle", tier: 0 }],
    },
    {
      title: "Moulis",
      rows: BALANCE.stages.flatMap((stage, i) => [
        {
          hint: String(i + 5),
          item: { ...mouliItem(stage.id), label: `${stage.name} +1` },
          name: `${stage.name} +1 instance`,
          tier: stage.tier,
        },
        {
          hint: `⇧${i + 5}`,
          item: {
            ...upgradeItem(stage.id),
            label: `${stage.name} v+1 (débit x${BALANCE.mouliUpgrade.throughputFactor})`,
          },
          name: `${stage.name} version suivante`,
          tier: stage.tier,
        },
      ]),
    },
  ];
}

const SECTIONS = rows();

interface Offer {
  row: Row;
  count: number;
  cost: number;
  /** null when buyable now, else why not. */
  blocked: string | null;
  wait: number | null;
}

function offer(row: Row, state: GameState, net: number, mode: Mode): Offer {
  const asked = mode === "max" ? Math.max(1, maxAffordable(state, row.item, MAX_COUNT)) : mode;
  const q = quote(state, row.item, asked);
  if (q.count === 0) {
    const error = q.error as IntentError | null;
    const blocked =
      error === "locked"
        ? `palier ${tierName(row.tier)}`
        : error
          ? INTENT_ERROR_MESSAGES[error]
          : "?";
    return { row, count: 0, cost: 0, blocked, wait: null };
  }
  const wait = affordableIn(q.cost, state.money, net);
  return { row, count: q.count, cost: q.cost, blocked: wait === 0 ? null : "", wait };
}

export function Shop({ p, act }: { p: Projection; act: Act }) {
  const [mode, setMode] = useState<Mode>(1);
  const offers = SECTIONS.map((section) => ({
    title: section.title,
    offers: section.rows.map((row) => offer(row, p.state, p.rates.netPerSecond, mode)),
  }));
  const buy = (o: Offer) => {
    if (o.blocked === null) act(o.row.item.intent(o.count), `${o.row.name} x${o.count}`);
  };

  const bindings: Record<string, () => void> = {
    x: () => setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length] ?? 1),
    escape: () => navigate({ name: "dashboard" }),
  };
  for (const o of offers.flatMap((s) => s.offers)) {
    bindings[o.row.hint.replace("⇧", "shift+")] = () => buy(o);
  }
  useShortcuts(bindings);

  return (
    <div className="grid">
      <Panel title="Boutique" wide>
        <p>
          Argent : <strong>{formatMoney(p.state.money)}</strong>{" "}
          <span className="dim">· quantité</span>{" "}
          {MODES.map((m) => (
            <Btn
              key={m}
              active={m === mode}
              onClick={() => setMode(m)}
              hint={m === 1 ? "x" : undefined}
            >
              {m === "max" ? "max" : `x${m}`}
            </Btn>
          ))}
        </p>
        <p className="dim small">
          Salles {p.state.rooms}/{BALANCE.rooms.max} ·{" "}
          {BALANCE.stages
            .map(
              (s, i) =>
                `${s.name} x${p.state.stages[i]?.instances ?? 0} v${(p.state.stages[i]?.version ?? 0) + 1}`,
            )
            .join(" · ")}
        </p>
      </Panel>
      {offers.map((section) => (
        <Panel key={section.title} title={section.title} wide={section.title === "Moulis"}>
          <ul className="list shop">
            {section.offers.map((o) => (
              <li key={o.row.item.key} className={o.count === 0 ? "dim" : undefined}>
                <Btn hint={o.row.hint} onClick={() => buy(o)} disabled={o.blocked !== null}>
                  {o.row.item.label}
                  {o.count > 1 && ` x${o.count}`}
                </Btn>{" "}
                {o.count > 0 && <span>{formatMoney(o.cost)}</span>}
                {o.blocked && <span className="dim"> {o.blocked}</span>}
                {o.wait !== null && o.wait > 0 && (
                  <span className="dim"> dans {formatDuration(o.wait)}</span>
                )}
                {o.wait === null && o.count > 0 && <span className="dim"> revenu net négatif</span>}
              </li>
            ))}
          </ul>
        </Panel>
      ))}
      <Panel title="Repères" wide>
        <p className="dim small">
          Une instance de mouli traite un débit fixe, réduit par sa sévérité. Une version double le
          débit de toutes les instances du stage. Les moulis coûtent un entretien par seconde,
          utilisées ou non. Les prix montent à chaque achat.
        </p>
      </Panel>
    </div>
  );
}
