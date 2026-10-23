import { THEME } from "@epidle/ui-theme";
import { describe, expect, it } from "vitest";
import { color, colorLevel } from "./theme";

describe("color", () => {
  it("degrades from truecolor to 16 colors to none", () => {
    expect(color("primary", 3)).toBe(THEME.primary.hex);
    expect(color("primary", 2)).toBe(THEME.primary.hex);
    expect(color("primary", 1)).toBe("blueBright");
    expect(color("primary", 0)).toBeUndefined();
  });
});

describe("colorLevel", () => {
  it("keeps what chalk detected", () => {
    expect(colorLevel({}, 3)).toBe(3);
    expect(colorLevel({}, 1)).toBe(1);
  });

  it("respects NO_COLOR when it is set to anything", () => {
    expect(colorLevel({ NO_COLOR: "1" }, 3)).toBe(0);
    expect(colorLevel({ NO_COLOR: "" }, 3)).toBe(3);
  });
});
