import { THEME, type TokenName } from "@epidle/ui-theme";
import chalk from "chalk";

// Terminal side of packages/ui-theme. Ink colors through the shared chalk instance, whose level
// says what the terminal supports: 3 truecolor, 2 ANSI 256, 1 ANSI 16, 0 none.

export type ColorLevel = 0 | 1 | 2 | 3;

/** https://no-color.org: any non-empty NO_COLOR disables colors. chalk ignores it, we don't. */
export function colorLevel(
  env: Record<string, string | undefined>,
  detected: ColorLevel = chalk.level,
): ColorLevel {
  return env.NO_COLOR ? 0 : detected;
}

/** Sets the level Ink renders with. Called once at startup. */
export function initColors(env: Record<string, string | undefined>): void {
  chalk.level = colorLevel(env);
}

/**
 * A token as an Ink color. Truecolor gets the exact hex, 256 colors get the same hex that chalk
 * maps to the nearest of the 256, 16 colors get the hand-picked name.
 */
export function color(name: TokenName, level: ColorLevel = chalk.level): string | undefined {
  if (level === 0) return undefined;
  return level === 1 ? THEME[name].ansi16 : THEME[name].hex;
}
