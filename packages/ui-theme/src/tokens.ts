// Epitech visual identity. Official values come from the epitech.eu theme palette
// (--wp--preset--color--*): primary #013AFB, black #181818, white #F2F4F8, and the three
// "tech / together / tomorrow" accents. Everything marked "derived" is ours, picked to pass WCAG AA.

export type TokenName =
  | "background"
  | "surface"
  | "border"
  | "text"
  | "muted"
  | "brand"
  | "primary"
  | "accent"
  | "success"
  | "warning"
  | "danger";

/** Ink color names for 16-color terminals. */
export type Ansi16 =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | "redBright"
  | "greenBright"
  | "yellowBright"
  | "blueBright"
  | "magentaBright"
  | "cyanBright"
  | "whiteBright";

export interface Token {
  hex: string;
  /** Picked by hand: the automatic hex -> 16 mapping turns navy, gray and mid blues into black. */
  ansi16: Ansi16;
}

export const THEME: Record<TokenName, Token> = {
  /** Official black. */
  background: { hex: "#181818", ansi16: "black" },
  /** Derived: panels, one step above the background. */
  surface: { hex: "#202020", ansi16: "black" },
  /** Derived from the Epitech blue, lightened to reach 3:1 (non-text UI) on the background. */
  border: { hex: "#3A5FFC", ansi16: "blue" },
  /** Official white. */
  text: { hex: "#F2F4F8", ansi16: "white" },
  /** Derived gray. */
  muted: { hex: "#9A9EA8", ansi16: "gray" },
  /** Official Epitech blue. Only as a fill behind `text`: as text on the background it is 2.5:1. */
  brand: { hex: "#013AFB", ansi16: "blue" },
  /** Derived: the Epitech blue lightened (same hue) for headings, links and active text. */
  primary: { hex: "#6B89FF", ansi16: "blueBright" },
  /** Official "tomorrow" pink: shortcut keys and the weekly modifier. */
  accent: { hex: "#FF1EF7", ansi16: "magentaBright" },
  /** Official "tech" green. */
  success: { hex: "#00FF97", ansi16: "greenBright" },
  /** Derived amber: the charter has no yellow. */
  warning: { hex: "#FFC53D", ansi16: "yellow" },
  /** Official "together" red-orange. */
  danger: { hex: "#FF5A3A", ansi16: "red" },
};

export const TOKEN_NAMES = Object.keys(THEME) as TokenName[];
