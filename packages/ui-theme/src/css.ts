import { THEME, TOKEN_NAMES } from "./tokens.ts";

/** The tokens as CSS custom properties (--background, --primary...), for a :root block. */
export function cssVariables(): string {
  return TOKEN_NAMES.map((name) => `--${name}: ${THEME[name].hex};`).join(" ");
}
