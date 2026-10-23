import type { Key } from "ink";
import { describe, expect, it } from "vitest";
import { keyName } from "./keys";

const none: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
  hyper: false,
  capsLock: false,
  numLock: false,
};

describe("keyName", () => {
  it("names special keys", () => {
    expect(keyName("", { ...none, escape: true })).toBe("escape");
    expect(keyName("\r", { ...none, return: true })).toBe("return");
    expect(keyName("", { ...none, upArrow: true })).toBe("up");
    expect(keyName("", { ...none, pageDown: true })).toBe("pagedown");
    expect(keyName("\t", { ...none, tab: true })).toBe("tab");
  });

  it("lowercases letters and keeps symbols", () => {
    expect(keyName("E", { ...none, shift: true })).toBe("e");
    expect(keyName("?", none)).toBe("?");
  });

  it("reads the AZERTY digit row as digits", () => {
    expect(["&", "é", '"', "'", "(", "-", "è", "_"].map((c) => keyName(c, none))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
    expect(keyName("3", none)).toBe("3");
  });

  it("ignores ctrl combos and pasted text", () => {
    expect(keyName("c", { ...none, ctrl: true })).toBeNull();
    expect(keyName("hello", none)).toBeNull();
  });
});
