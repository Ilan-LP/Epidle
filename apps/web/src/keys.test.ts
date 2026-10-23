import { describe, expect, it } from "vitest";
import { normalizeKey } from "./keys";

describe("normalizeKey", () => {
  it("reads digits from the physical key (AZERTY)", () => {
    expect(normalizeKey({ key: "&", code: "Digit1", shiftKey: false })).toBe("1");
    expect(normalizeKey({ key: "1", code: "Digit1", shiftKey: true })).toBe("shift+1");
    expect(normalizeKey({ key: "!", code: "Digit1", shiftKey: true })).toBe("shift+1");
    expect(normalizeKey({ key: "3", code: "Numpad3", shiftKey: false })).toBe("3");
  });

  it("lowercases every key name", () => {
    expect(normalizeKey({ key: "E", code: "KeyE", shiftKey: true })).toBe("e");
    expect(normalizeKey({ key: "Escape", code: "Escape", shiftKey: false })).toBe("escape");
    expect(normalizeKey({ key: "?", code: "Comma", shiftKey: true })).toBe("?");
  });
});
