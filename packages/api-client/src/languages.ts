// Purely cosmetic (CLAUDE.md): the language changes the scrolling code, its colors and the
// prompt. It never touches the game, and its colors stay inside the code snippets.

export type LanguageId = "c" | "cpp" | "haskell" | "python" | "typescript" | "rust";

export interface Language {
  id: LanguageId;
  name: string;
  /** Shown in the header, like an editor tab. */
  file: string;
  /** Prefix of the log lines. */
  prompt: string;
  /** Keywords in the code snippets: the only place the language colors reach. */
  keyword: string;
  /** String literals. */
  string: string;
  comment: string;
  keywords: readonly string[];
  snippets: readonly string[];
}

export const LANGUAGES: readonly Language[] = [
  {
    id: "c",
    name: "C",
    file: "epidle.c",
    prompt: "$",
    keyword: "#5fd75f",
    string: "#d7af5f",
    comment: "//",
    keywords: [
      "int",
      "char",
      "void",
      "const",
      "return",
      "while",
      "if",
      "else",
      "for",
      "struct",
      "static",
      "unsigned",
      "size_t",
      "NULL",
    ],
    snippets: [
      "int my_strlen(char const *str)\n{\n    int i = 0;\n\n    while (str[i] != '\\0')\n        i++;\n    return i;\n}",
      "#include <unistd.h>\n\nvoid my_putchar(char c)\n{\n    write(1, &c, 1);\n}",
      "int main(int ac, char **av)\n{\n    if (ac != 2)\n        return 84;\n    my_putstr(av[1]);\n    my_putchar('\\n');\n    return 0;\n}",
      "// TODO: free the list before the mouli sees it\nvoid free_list(list_t *head)\n{\n    list_t *next = NULL;\n\n    for (; head != NULL; head = next) {\n        next = head->next;\n        free(head);\n    }\n}",
    ],
  },
  {
    id: "cpp",
    name: "C++",
    file: "Epidle.cpp",
    prompt: "$",
    keyword: "#f06292",
    string: "#a5d6a7",
    comment: "//",
    keywords: [
      "class",
      "public",
      "private",
      "const",
      "return",
      "for",
      "auto",
      "bool",
      "int",
      "explicit",
      "std",
      "void",
      "if",
      "override",
      "virtual",
    ],
    snippets: [
      "class Mouli {\npublic:\n    explicit Mouli(int strictness) : _strictness(strictness) {}\n    bool check(const std::string &code) const;\n\nprivate:\n    int _strictness;\n};",
      'for (auto &dev : team)\n    dev.train(Level::Piscine);\nstd::cout << "LoC: " << loc << std::endl;',
      "class IDev {\npublic:\n    virtual ~IDev() = default;\n    virtual double locPerSecond() const = 0;\n};",
    ],
  },
  {
    id: "haskell",
    name: "Haskell",
    file: "Epidle.hs",
    prompt: "ghci>",
    keyword: "#b39ddb",
    string: "#ffcc80",
    comment: "--",
    keywords: [
      "module",
      "where",
      "import",
      "data",
      "case",
      "of",
      "let",
      "in",
      "do",
      "if",
      "then",
      "else",
      "main",
      "IO",
      "Int",
    ],
    snippets: [
      "myLength :: [a] -> Int\nmyLength [] = 0\nmyLength (_:xs) = 1 + myLength xs",
      "main :: IO ()\nmain = do\n  args <- getArgs\n  case args of\n    [file] -> readFile file >>= putStr\n    _      -> exitWith (ExitFailure 84)",
      "-- pure, like the game core\nrevenue :: Double -> Double -> Double\nrevenue loc quality = loc * quality * 1.5",
    ],
  },
  {
    id: "python",
    name: "Python",
    file: "epidle.py",
    prompt: ">>>",
    keyword: "#ffd43b",
    string: "#7ec8e3",
    comment: "#",
    keywords: [
      "def",
      "return",
      "for",
      "in",
      "if",
      "else",
      "import",
      "from",
      "class",
      "None",
      "True",
      "False",
      "print",
      "len",
      "with",
    ],
    snippets: [
      'def ship(loc, quality):\n    """Revenue for shipped lines."""\n    return loc * quality * 1.5',
      'for dev in team:\n    if dev.level < 2:\n        dev.train("Piscine")\nprint(f"{len(team)} devs")',
      "# the mouli is always right\nclass Mouli:\n    def __init__(self, strictness=1):\n        self.strictness = strictness",
    ],
  },
  {
    id: "typescript",
    name: "TypeScript",
    file: "epidle.ts",
    prompt: ">",
    keyword: "#4ea1ff",
    string: "#ce9178",
    comment: "//",
    keywords: [
      "interface",
      "const",
      "let",
      "type",
      "return",
      "number",
      "string",
      "export",
      "function",
      "import",
      "from",
      "async",
      "await",
      "if",
    ],
    snippets: [
      "interface Dev {\n  id: number;\n  level: number;\n}",
      "const hire = (team: Dev[]): Dev[] => [\n  ...team,\n  { id: team.length + 1, level: 0 },\n];",
      'export async function ship(loc: number) {\n  // TODO: tests\n  await deploy("prod", { loc });\n}',
    ],
  },
  {
    id: "rust",
    name: "Rust",
    file: "epidle.rs",
    prompt: "$",
    keyword: "#ff8c42",
    string: "#9ccc65",
    comment: "//",
    keywords: [
      "fn",
      "let",
      "mut",
      "match",
      "impl",
      "struct",
      "pub",
      "use",
      "return",
      "Ok",
      "Err",
      "self",
      "usize",
      "for",
      "in",
    ],
    snippets: [
      "fn my_strlen(s: &str) -> usize {\n    s.chars().count()\n}",
      'match mouli.check(&code) {\n    Ok(score) => println!("{score}%"),\n    Err(e) => eprintln!("{e}"),\n}',
      "// the borrow checker is a mouli too\npub struct Team {\n    devs: Vec<Dev>,\n}",
    ],
  },
];

export const DEFAULT_LANGUAGE: Language = LANGUAGES[0] as Language;

export const languageById = (id: string | null): Language =>
  LANGUAGES.find((l) => l.id === id) ?? DEFAULT_LANGUAGE;

/** Every line of every snippet, with a blank line between snippets. */
export const codeLines = (lang: Language): string[] =>
  lang.snippets.flatMap((s) => [...s.split("\n"), ""]);

export type TokenKind = "plain" | "keyword" | "string" | "comment" | "number";

export interface Token {
  kind: TokenKind;
  text: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Line-level highlighter: enough for decoration, not a parser. */
export function highlight(line: string, lang: Language): Token[] {
  const re = new RegExp(
    `(${escapeRegExp(lang.comment)}.*$)|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)')|(\\b\\d+(?:\\.\\d+)?\\b)|(^\\s*#\\w+|[A-Za-z_]\\w*)`,
    "g",
  );
  const keywords = new Set(lang.keywords);
  const tokens: Token[] = [];
  let last = 0;
  for (const m of line.matchAll(re)) {
    const [text, comment, str, num, word] = m;
    const start = m.index ?? 0;
    if (start > last) tokens.push({ kind: "plain", text: line.slice(last, start) });
    let kind: TokenKind = "plain";
    if (comment) kind = "comment";
    else if (str) kind = "string";
    else if (num) kind = "number";
    else if (word && (keywords.has(word) || word.trimStart().startsWith("#"))) kind = "keyword";
    tokens.push({ kind, text });
    last = start + text.length;
  }
  if (last < line.length) tokens.push({ kind: "plain", text: line.slice(last) });
  return tokens;
}
