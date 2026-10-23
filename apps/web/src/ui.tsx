import { BALANCE } from "@epidle/core";
import type { ReactNode } from "react";
import { bar, formatPercent } from "./format";
import { highlight, type Language } from "./languages";

export function Panel({
  title,
  children,
  wide,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className={wide ? "panel wide" : "panel"}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export type Tone = "ok" | "warn" | "bad" | "dim";

/** Text bar. Screen readers get the percentage instead of the block characters. */
export function Bar({ ratio, width = 20, tone }: { ratio: number; width?: number; tone?: Tone }) {
  return (
    <span className={`bar ${tone ?? ""}`} role="img" aria-label={formatPercent(ratio)}>
      {bar(ratio, width)}
    </span>
  );
}

/** Shortcut hint, hidden on touch screens. */
export const Key = ({ k }: { k: string }) => <kbd className="key">{k}</kbd>;

export function Btn({
  onClick,
  disabled,
  hint,
  active,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
  active?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? "btn active" : "btn"}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
    >
      {hint && <Key k={hint} />}
      {children}
    </button>
  );
}

export function Code({ line, lang }: { line: string; lang: Language }) {
  return (
    <>
      {highlight(line, lang).map((t, i) => (
        // Tokens of a static line never move: the index is a stable key.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <span key={i} className={`tok-${t.kind}`}>
          {t.text}
        </span>
      ))}
    </>
  );
}

export const levelName = (level: number) => BALANCE.levels[level] ?? `niveau ${level}`;
export const tierName = (tier: number) => BALANCE.tiers[tier]?.name ?? `palier ${tier}`;
export const strictnessName = (level: number) => BALANCE.strictness[level]?.name ?? "?";
