import {
  formatDuration,
  formatMoney,
  MODES,
  type Mode,
  type Offer,
  offer,
  type Projection,
  SHOP_SECTIONS,
} from "@epidle/api-client";
import { BALANCE } from "@epidle/core";
import { useState } from "react";
import type { Act } from "../hooks";
import { useShortcuts } from "../keys";
import { navigate } from "../router";
import { Btn, Panel } from "../ui";

export function Shop({ p, act }: { p: Projection; act: Act }) {
  const [mode, setMode] = useState<Mode>(1);
  const offers = SHOP_SECTIONS.map((section) => ({
    title: section.title,
    offers: section.rows.map((row) => offer(row, p.state, p.rates.netPerSecond, mode, p.cfg)),
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
