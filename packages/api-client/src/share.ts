import { BALANCE, DAY, weekIndex, weeksPerSeason } from "@epidle/core";
import {
  formatMoney,
  formatNumber,
  formatPercent,
  formatRate,
  levelName,
  strictnessName,
  tierName,
} from "./format";
import type { Projection } from "./projection";

// "Copy my build": a text snapshot to paste in Discord. A code block keeps the columns and the
// terminal look; the link goes after it so Discord makes it clickable. No money: only what the
// leaderboard and the public build already show, plus the rates.

export interface ShareInput {
  pseudo: string;
  p: Projection;
  /** Season rank, null if not ranked yet. */
  rank: number | null;
  /** Origin of the web client, e.g. "https://epidle.example.org". */
  webUrl: string;
}

const MAX_GROUPS = 4;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function buildLink(webUrl: string, pseudo: string): string {
  return `${webUrl.replace(/\/+$/, "")}/#/joueur/${encodeURIComponent(pseudo)}`;
}

export function shareText({ pseudo, p, rank, webUrl }: ShareInput): string {
  const { state: s, rates: r, season } = p;
  const week = weekIndex(s.time);
  const modifier = season.weeks[week];
  const header = [
    `Epidle · saison ${season.id}`,
    `semaine ${week + 1}/${weeksPerSeason()}${modifier ? ` (${modifier.name})` : ""}`,
    `jour ${Math.min(Math.floor(s.time / DAY) + 1, BALANCE.seasonSeconds / DAY)}`,
  ].join(" · ");

  const levels = new Map<number, { count: number; training: number }>();
  for (const dev of s.devs) {
    const g = levels.get(dev.level) ?? { count: 0, training: 0 };
    g.count++;
    if (dev.training) g.training++;
    levels.set(dev.level, g);
  }
  const groups = [...levels.entries()].sort((a, b) => b[0] - a[0]);
  const team = groups
    .slice(0, MAX_GROUPS)
    .map(
      ([level, g]) =>
        `${g.count} ${levelName(level)}${g.training ? ` (${g.training} en formation)` : ""}`,
    );
  if (groups.length > MAX_GROUPS) team.push("…");

  const moulis = BALANCE.stages
    .map((stage, i) => ({ stage, st: s.stages[i] }))
    .filter(({ st }) => st && st.instances > 0)
    .map(
      ({ stage, st }) =>
        `${capitalize(stage.name.replace("Mouli ", ""))} x${st?.instances} v${(st?.version ?? 0) + 1} ${strictnessName(st?.strictness ?? 0)}`,
    );

  return [
    "```",
    header,
    `${pseudo} · ${rank ? `#${rank}` : "non classé"} · ${tierName(s.tier)} · ${formatMoney(s.revenue)}`,
    `Prod    ${formatNumber(r.locPerSecond, 1)} LoC/s · qualité ${formatPercent(r.quality)} · ${formatRate(r.revenuePerSecond)}`,
    `Équipe  ${s.devs.length} devs : ${team.join(", ")}`,
    `Salles  ${s.rooms} · Moulis ${moulis.length ? moulis.join(" | ") : "aucune"}`,
    "```",
    buildLink(webUrl, pseudo),
  ].join("\n");
}
