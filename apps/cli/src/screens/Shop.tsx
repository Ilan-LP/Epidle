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
import type { Game } from "@epidle/api-client/react";
import { BALANCE } from "@epidle/core";
import { Box, Text } from "ink";
import { useState } from "react";
import type { Navigate } from "../Game";
import { useKeys } from "../keys";
import { col, K, Panel, T } from "../ui";

/** Digit shortcuts of the web shop (1-8). Upgrades (⇧ on the web) are reached with the cursor. */
const digit = (hint: string) => (/^\d$/.test(hint) ? hint : null);

export function Shop({
  p,
  act,
  say,
  navigate,
  wide,
}: {
  p: Projection;
  act: Game["act"];
  say: Game["say"];
  navigate: Navigate;
  wide: boolean;
}) {
  const [mode, setMode] = useState<Mode>(1);
  const [cursor, setCursor] = useState(0);
  const sections = SHOP_SECTIONS.map((section) => ({
    title: section.title,
    offers: section.rows.map((row) => offer(row, p.state, p.rates.netPerSecond, mode, p.cfg)),
  }));
  const all = sections.flatMap((s) => s.offers);
  const buy = (o: Offer | undefined) => {
    if (!o) return;
    const label = `${o.row.name} x${Math.max(1, o.count)}`;
    if (o.blocked === null) act(o.row.item.intent(o.count), label);
    // No greyed-out button in a terminal: say why instead.
    else if (o.blocked) say("err", `${label} : ${o.blocked}`);
    else if (o.wait !== null)
      say("err", `${label} : pas assez d'argent, dans ${formatDuration(o.wait)}`);
    else say("err", `${label} : pas assez d'argent, revenu net négatif`);
  };
  const move = (delta: number) => setCursor((c) => (c + delta + all.length) % all.length);

  const bindings: Record<string, () => void> = {
    x: () => setMode((m) => MODES[(MODES.indexOf(m) + 1) % MODES.length] ?? 1),
    up: () => move(-1),
    k: () => move(-1),
    down: () => move(1),
    j: () => move(1),
    return: () => buy(all[cursor]),
    escape: () => navigate({ name: "dashboard" }),
  };
  all.forEach((o, i) => {
    const d = digit(o.row.hint);
    if (d)
      bindings[d] = () => {
        setCursor(i);
        buy(o);
      };
  });
  useKeys(bindings);

  let index = 0;
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        Argent : <Text bold>{formatMoney(p.state.money)}</Text>
        <T tone="dim"> · quantité </T>
        <K k="x" />{" "}
        {MODES.map((m) => {
          const label = m === "max" ? "max" : `x${m}`;
          return (
            <Text key={m}>
              {m === mode ? <Text inverse>{label}</Text> : <T tone="dim">{label}</T>}{" "}
            </Text>
          );
        })}
      </Text>
      <T tone="dim">
        Salles {p.state.rooms}/{BALANCE.rooms.max} ·{" "}
        {BALANCE.stages
          .map(
            (s, i) =>
              `${s.name} x${p.state.stages[i]?.instances ?? 0} v${(p.state.stages[i]?.version ?? 0) + 1}`,
          )
          .join(" · ")}
      </T>
      <Box flexDirection={wide ? "row" : "column"}>
        {[sections.slice(0, 2), sections.slice(2)].map((group) => (
          <Box key={group[0]?.title} flexDirection="column" width={wide ? "50%" : undefined}>
            {group.map((section) => (
              <Panel key={section.title} title={section.title}>
                {section.offers.map((o) => {
                  const i = index++;
                  return <Line key={o.row.item.key} o={o} selected={i === cursor} />;
                })}
              </Panel>
            ))}
          </Box>
        ))}
      </Box>
      <T tone="dim">
        [↑↓] choisir · [Entrée] acheter · [1-8] achat direct · [Échap] retour. Les prix montent à
        chaque achat, une mouli coûte un entretien par seconde.
      </T>
    </Box>
  );
}

const LABEL_WIDTH = 34;

function Line({ o, selected }: { o: Offer; selected: boolean }) {
  const d = digit(o.row.hint);
  const label = `${o.row.item.label}${o.count > 1 ? ` x${o.count}` : ""}`;
  return (
    <Text wrap="truncate">
      {selected ? <Text bold>›</Text> : " "}
      {d ? <K k={d} /> : "   "}{" "}
      {selected ? (
        <Text inverse>{col(label, LABEL_WIDTH)}</Text>
      ) : (
        <T tone={o.blocked === null ? undefined : "dim"}>{col(label, LABEL_WIDTH)}</T>
      )}{" "}
      {o.count > 0 && <Text>{formatMoney(o.cost)}</Text>}
      {o.blocked && <T tone="dim"> {o.blocked}</T>}
      {o.wait !== null && o.wait > 0 && <T tone="dim"> dans {formatDuration(o.wait)}</T>}
      {o.wait === null && o.count > 0 && <T tone="dim"> revenu net négatif</T>}
    </Text>
  );
}
