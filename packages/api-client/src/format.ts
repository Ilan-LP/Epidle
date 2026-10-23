import { BALANCE } from "@epidle/core";

// French number formatting for a monospace UI: short, stable widths, no locale surprises.

const SUFFIXES = ["", " k", " M", " Md", " Bn", " Brd"];

const fixed = (n: number, decimals: number) => n.toFixed(decimals).replace(".", ",");

/**
 * Under 1000, `smallDecimals` decimals. Above, 3 significant digits and a French suffix
 * (k, M, Md, Bn, Brd), then scientific notation.
 */
export function formatNumber(n: number, smallDecimals = 0): string {
  if (Number.isNaN(n)) return "?";
  if (!Number.isFinite(n)) return n > 0 ? "∞" : "-∞";
  const sign = n < 0 ? "-" : "";
  let a = Math.abs(n);
  if (a < 1000) return sign + fixed(a, smallDecimals);
  let i = 0;
  while (a >= 999.5 && i < SUFFIXES.length - 1) {
    a /= 1000;
    i++;
  }
  if (a >= 999.5) return sign + Math.abs(n).toExponential(2).replace(".", ",");
  const decimals = a < 9.995 ? 2 : a < 99.95 ? 1 : 0;
  return sign + fixed(a, decimals) + SUFFIXES[i];
}

export const formatMoney = (n: number): string => `${formatNumber(n, 2)} €`;

export const formatRate = (n: number, unit = "€"): string =>
  `${n > 0 ? "+" : ""}${formatNumber(n, Math.abs(n) < 10 ? 2 : 1)} ${unit}/s`;

export const formatPercent = (ratio: number): string => `${Math.round(ratio * 100)} %`;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "45 s", "8 min 05 s", "2 h 05 min", "3 j 04 h". Rounds up, so 0.2 s shows as 1 s. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "∞";
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${pad2(s % 60)} s`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${pad2(Math.floor((s % 3600) / 60))} min`;
  return `${Math.floor(s / 86400)} j ${pad2(Math.floor((s % 86400) / 3600))} h`;
}

const PARTIAL = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

/** Text progress bar of exactly `width` characters. Ratio is clamped to [0, 1]. */
export function bar(ratio: number, width = 20): string {
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const eighths = Math.round(r * width * 8);
  const full = Math.floor(eighths / 8);
  const partial = PARTIAL[eighths % 8] ?? "";
  return "█".repeat(full) + partial + "░".repeat(width - full - (partial ? 1 : 0));
}

export const levelName = (level: number) => BALANCE.levels[level] ?? `niveau ${level}`;
export const tierName = (tier: number) => BALANCE.tiers[tier]?.name ?? `palier ${tier}`;
export const strictnessName = (level: number) => BALANCE.strictness[level]?.name ?? "?";
