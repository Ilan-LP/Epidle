import { type Key, useInput } from "ink";
import { useRef } from "react";

// Terminals send characters, not physical keys. On AZERTY the digit row types "&é\"'(-è_çà"
// without Shift, so those map to digits like the web client's event.code does.
const AZERTY_DIGITS: Record<string, string> = {
  "&": "1",
  é: "2",
  '"': "3",
  "'": "4",
  "(": "5",
  "-": "6",
  è: "7",
  _: "8",
  ç: "9",
  à: "0",
};

/** Name of a key press for the bindings, or null to ignore it (modifiers, pasted text). */
export function keyName(input: string, key: Key): string | null {
  if (key.escape) return "escape";
  if (key.return) return "return";
  if (key.upArrow) return "up";
  if (key.downArrow) return "down";
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  if (key.pageUp) return "pageup";
  if (key.pageDown) return "pagedown";
  if (key.tab) return key.shift ? "shift+tab" : "tab";
  if (key.backspace || key.delete) return "backspace";
  if (key.ctrl || key.meta) return null;
  if ([...input].length !== 1) return null;
  return AZERTY_DIGITS[input] ?? input.toLowerCase();
}

export type Bindings = Record<string, () => void>;

/** Several of these are active at once (global keys plus the screen's): keep them disjoint. */
export function useKeys(bindings: Bindings, isActive = true): void {
  const latest = useRef(bindings);
  latest.current = bindings;
  useInput(
    (input, key) => {
      const name = keyName(input, key);
      if (name) latest.current[name]?.();
    },
    { isActive },
  );
}
