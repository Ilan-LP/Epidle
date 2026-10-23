import { contrast, THEME } from "@epidle/ui-theme";
import { describe, expect, it } from "vitest";
import { codeLines, DEFAULT_LANGUAGE, highlight, LANGUAGES, languageById } from "./languages";

const lang = (id: string) => languageById(id);

describe("languages", () => {
  it("all have code and distinct colors", () => {
    for (const l of LANGUAGES) expect(codeLines(l).length).toBeGreaterThan(5);
    expect(new Set(LANGUAGES.map((l) => l.keyword)).size).toBe(LANGUAGES.length);
  });

  it("keep their snippet colors readable on the theme panels (WCAG AA)", () => {
    for (const l of LANGUAGES) {
      for (const color of [l.keyword, l.string]) {
        expect(contrast(color, THEME.surface.hex)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("falls back to the default language", () => {
    expect(languageById(null)).toBe(DEFAULT_LANGUAGE);
    expect(languageById("cobol")).toBe(DEFAULT_LANGUAGE);
  });
});

describe("highlight", () => {
  it("never loses characters", () => {
    for (const l of LANGUAGES) {
      for (const line of codeLines(l)) {
        expect(
          highlight(line, l)
            .map((t) => t.text)
            .join(""),
        ).toBe(line);
      }
    }
  });

  it("finds keywords, strings, numbers and comments", () => {
    const kinds = (line: string, id: string) =>
      highlight(line, lang(id))
        .filter((t) => t.kind !== "plain")
        .map((t) => `${t.kind}:${t.text}`);
    expect(kinds('    return 84; // "bye"', "c")).toEqual([
      "keyword:return",
      "number:84",
      'comment:// "bye"',
    ]);
    expect(kinds("#include <unistd.h>", "c")).toEqual(["keyword:#include"]);
    expect(kinds('print("hi")  # done', "python")).toEqual([
      "keyword:print",
      'string:"hi"',
      "comment:# done",
    ]);
    expect(kinds("myLength [] = 0 -- base", "haskell")).toEqual(["number:0", "comment:-- base"]);
  });
});
