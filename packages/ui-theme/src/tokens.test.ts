import { describe, expect, it } from "vitest";
import { contrast } from "./contrast";
import { cssVariables } from "./css";
import { THEME, TOKEN_NAMES, type TokenName } from "./tokens";

// WCAG AA: 4.5:1 for text, 3:1 for UI parts (borders, focus rings). Change a color, this tells you
// whether it still reads on both backgrounds the UI paints.
const TEXT: TokenName[] = ["text", "muted", "primary", "accent", "success", "warning", "danger"];
const GROUNDS: TokenName[] = ["background", "surface"];

describe("theme contrast", () => {
  for (const fg of TEXT) {
    for (const bg of GROUNDS) {
      it(`${fg} text on ${bg} passes AA`, () => {
        expect(contrast(THEME[fg].hex, THEME[bg].hex)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  for (const bg of GROUNDS) {
    it(`border on ${bg} reaches 3:1`, () => {
      expect(contrast(THEME.border.hex, THEME[bg].hex)).toBeGreaterThanOrEqual(3);
    });
  }

  it("text on the Epitech blue fill passes AA", () => {
    expect(contrast(THEME.text.hex, THEME.brand.hex)).toBeGreaterThanOrEqual(4.5);
  });

  it("the raw Epitech blue fails as text, which is why primary exists", () => {
    expect(contrast(THEME.brand.hex, THEME.background.hex)).toBeLessThan(4.5);
  });

  it("matches known WCAG values", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21);
    expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });
});

describe("tokens", () => {
  it("are all 6-digit hex", () => {
    for (const name of TOKEN_NAMES) expect(THEME[name].hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("render as CSS variables", () => {
    expect(cssVariables()).toContain("--primary: #6B89FF;");
    expect(cssVariables().split(";").length - 1).toBe(TOKEN_NAMES.length);
  });
});
