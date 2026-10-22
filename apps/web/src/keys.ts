import { useEffect, useRef } from "react";

// Keyboard shortcuts, as lowercase key names ("e", "escape"). Digits are read from the physical
// key (event.code), so they work on AZERTY keyboards where typing "1" needs Shift.
// Shift + digit is reported as "shift+1".

export function normalizeKey(e: Pick<KeyboardEvent, "key" | "code" | "shiftKey">): string {
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1];
  if (digit) return e.shiftKey ? `shift+${digit}` : digit;
  return e.key.toLowerCase();
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Registers shortcuts for the lifetime of the component. Ignored while typing in a field. */
export function useShortcuts(bindings: Record<string, () => void>) {
  const ref = useRef(bindings);
  ref.current = bindings;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const action = ref.current[normalizeKey(e)];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
