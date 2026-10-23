import {
  bar,
  DEFAULT_LANGUAGE,
  highlight,
  type Language,
  type TokenKind,
} from "@epidle/api-client";
import { Box, Text } from "ink";
import { createContext, type ReactNode, useContext } from "react";

// Terminal counterparts of the web components. Colors come from the cosmetic language.

export const LanguageContext = createContext<Language>(DEFAULT_LANGUAGE);
export const useLang = () => useContext(LanguageContext);

export type Tone = "ok" | "warn" | "bad" | "dim";
const TONE_COLORS: Record<Exclude<Tone, "dim">, string> = {
  ok: "green",
  warn: "yellow",
  bad: "red",
};

/** Text in a tone. "dim" is gray rather than ANSI dim, which some terminals ignore. */
export function T({ tone, children, bold }: { tone?: Tone; children: ReactNode; bold?: boolean }) {
  const color = tone === "dim" ? "gray" : tone ? TONE_COLORS[tone] : undefined;
  return (
    <Text color={color} bold={bold}>
      {children}
    </Text>
  );
}

/** Accent-colored text. */
export function A({ children, bold }: { children: ReactNode; bold?: boolean }) {
  return (
    <Text color={useLang().accent} bold={bold}>
      {children}
    </Text>
  );
}

/** Shortcut hint, e.g. [e]. */
export const K = ({ k }: { k: string }) => <A>[{k}]</A>;

const RULE = "─".repeat(300);

/** Titled section: the title sits on a rule, cut to the panel width. */
export function Panel({
  title,
  children,
  width,
  grow,
}: {
  title: string;
  children: ReactNode;
  width?: number | string;
  grow?: boolean;
}) {
  return (
    <Box
      flexDirection="column"
      width={width}
      flexGrow={grow ? 1 : 0}
      flexShrink={0}
      paddingRight={1}
    >
      <Text wrap="truncate" color={useLang().accent}>
        ── <Text bold>{title}</Text> {RULE}
      </Text>
      {children}
    </Box>
  );
}

export function Bar({ ratio, width = 20, tone }: { ratio: number; width?: number; tone?: Tone }) {
  return <T tone={tone}>{bar(ratio, width)}</T>;
}

export function Code({ line }: { line: string }) {
  const lang = useLang();
  return (
    <Text wrap="truncate">
      {highlight(line, lang).map((t, i) => (
        // Tokens of a static line never move: the index is a stable key.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <Text key={i} color={TOKEN_COLORS[t.kind](lang)}>
          {t.text}
        </Text>
      ))}
    </Text>
  );
}

const TOKEN_COLORS: Record<TokenKind, (l: Language) => string | undefined> = {
  plain: () => undefined,
  keyword: (l) => l.accent,
  string: (l) => l.string,
  number: () => "magenta",
  comment: () => "gray",
};

/** Pads to a fixed width for aligned columns, right-aligned for numbers. */
export const col = (text: string, width: number, right = false) =>
  right ? text.padStart(width) : text.padEnd(width);
