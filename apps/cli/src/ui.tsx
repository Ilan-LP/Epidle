import {
  bar,
  DEFAULT_LANGUAGE,
  highlight,
  type Language,
  type TokenKind,
} from "@epidle/api-client";
import type { TokenName } from "@epidle/ui-theme";
import { Box, Text } from "ink";
import { createContext, type ReactNode, useContext } from "react";
import { color } from "./theme";

// Terminal counterparts of the web components. Colors are the theme tokens (./theme); the
// cosmetic language only colors the code snippets.

export const LanguageContext = createContext<Language>(DEFAULT_LANGUAGE);
export const useLang = () => useContext(LanguageContext);

export type Tone = "ok" | "warn" | "bad" | "dim";
const TONE_TOKENS: Record<Tone, TokenName> = {
  ok: "success",
  warn: "warning",
  bad: "danger",
  // A gray color rather than ANSI dim, which some terminals ignore.
  dim: "muted",
};

/** Text in a tone. */
export function T({ tone, children, bold }: { tone?: Tone; children: ReactNode; bold?: boolean }) {
  return (
    <Text color={tone && color(TONE_TOKENS[tone])} bold={bold}>
      {children}
    </Text>
  );
}

/** Primary-colored text (Epitech blue). */
export function A({ children, bold }: { children: ReactNode; bold?: boolean }) {
  return (
    <Text color={color("primary")} bold={bold}>
      {children}
    </Text>
  );
}

/** Shortcut hint, e.g. [e]. */
export const K = ({ k }: { k: string }) => <Text color={color("accent")}>[{k}]</Text>;

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
      <Text wrap="truncate" color={color("border")}>
        ──{" "}
        <Text bold color={color("primary")}>
          {title}
        </Text>{" "}
        {RULE}
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

/** Keywords and strings are the cosmetic language layer, the rest follows the theme. */
const TOKEN_COLORS: Record<TokenKind, (l: Language) => string | undefined> = {
  plain: () => undefined,
  keyword: (l) => l.keyword,
  string: (l) => l.string,
  number: () => color("warning"),
  comment: () => color("muted"),
};

/** Pads to a fixed width for aligned columns, right-aligned for numbers. */
export const col = (text: string, width: number, right = false) =>
  right ? text.padStart(width) : text.padEnd(width);
