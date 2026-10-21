/**
 * The formatted view of a file on the Files page (issue 308): Markdown as a page, JSON with its
 * indent, and code with its comments, strings, numbers and keywords apart from the rest. The
 * tokens are plain text, so React escapes them, and no file text ever becomes HTML.
 */

export type FileView = "markdown" | "json" | "code" | "plain";

export type TokenKind = "plain" | "comment" | "string" | "number" | "keyword" | "key" | "tag";

export interface CodeToken {
  readonly kind: TokenKind;
  readonly text: string;
}

interface Grammar {
  readonly comments: readonly string[];
  readonly strings: readonly string[];
  readonly keywords: ReadonlySet<string>;
  /** SQL keywords are in any case. */
  readonly anyCase?: boolean;
  /** HTML and XML: `<name`, `</name` and `>` are tags. */
  readonly tags?: boolean;
  /** JSON: a string before a colon is a key. */
  readonly keys?: boolean;
}

/** An unclosed string ends at its line, so one stray quote does not colour the rest of the file. */
const doubleQuoted = String.raw`"(?:[^"\\\n]|\\.)*"?`;
const singleQuoted = String.raw`'(?:[^'\\\n]|\\.)*'?`;
const backQuoted = String.raw`\x60(?:[^\x60\\]|\\[\s\S])*\x60?`;
const tripleQuoted = String.raw`"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)`;
const slashComments = [String.raw`//[^\n]*`, String.raw`/\*[\s\S]*?(?:\*/|$)`];
const hashComment = String.raw`#[^\n]*`;

const words = (text: string): ReadonlySet<string> => new Set(text.split(" "));

const cLike: Grammar = {
  comments: slashComments,
  strings: [doubleQuoted, singleQuoted, backQuoted],
  keywords: words(
    "abstract as async await break case catch class const continue default delete do else enum export extends false final finally fn for from func function go if impl implements import in instanceof interface let match mod mut new null package private protected public return self static struct super switch this throw true try type typeof undefined use var void while with yield",
  ),
};

const scripting: Grammar = {
  comments: [hashComment],
  strings: [tripleQuoted, doubleQuoted, singleQuoted],
  keywords: words(
    "and as assert async await begin break case class def del do done elif else elsif end esac except False fi finally for from function global if import in is lambda module None nonlocal not or pass raise require return self then True try unless until while with yield",
  ),
};

const grammars: Readonly<Record<string, Grammar>> = {
  cLike,
  // A Rust lifetime, such as `'a`, is no string.
  rust: { ...cLike, strings: [doubleQuoted] },
  scripting,
  config: {
    comments: [hashComment],
    strings: [doubleQuoted, singleQuoted],
    keywords: words("true false yes no null on off"),
  },
  css: {
    comments: [String.raw`/\*[\s\S]*?(?:\*/|$)`],
    strings: [doubleQuoted, singleQuoted],
    keywords: words("important"),
  },
  sql: {
    comments: [String.raw`--[^\n]*`, String.raw`/\*[\s\S]*?(?:\*/|$)`],
    strings: [singleQuoted, doubleQuoted],
    keywords: words(
      "add all alter and as asc by create delete desc distinct drop from group having in insert into is join left limit not null on or order primary key right select set table union update values where with",
    ),
    anyCase: true,
  },
  markup: {
    comments: [String.raw`<!--[\s\S]*?(?:-->|$)`],
    // An apostrophe in text, such as "don't", is no string.
    strings: [doubleQuoted],
    keywords: new Set(),
    tags: true,
  },
  json: { comments: [], strings: [doubleQuoted], keywords: words("true false null"), keys: true },
};

const grammarOfExtension: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    "js jsx mjs cjs ts tsx mts cts java c h cc cpp hpp cs go swift kt kts dart php scala groovy"
      .split(" ")
      .map((extension) => [extension, "cLike"]),
  ),
  ...Object.fromEntries("py rb sh bash zsh ps1 r pl".split(" ").map((extension) => [extension, "scripting"])),
  ...Object.fromEntries(
    "yaml yml toml ini cfg conf env properties".split(" ").map((extension) => [extension, "config"]),
  ),
  ...Object.fromEntries("css scss less".split(" ").map((extension) => [extension, "css"])),
  ...Object.fromEntries("html htm xml svg vue".split(" ").map((extension) => [extension, "markup"])),
  rs: "rust",
  sql: "sql",
  json: "json",
  jsonc: "json",
};

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function viewOf(path: string): FileView {
  const extension = extensionOf(path);
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "json") return "json";
  return extension in grammarOfExtension ? "code" : "plain";
}

/**
 * The JSON with two spaces of indent, or null when it does not parse. It moves only the spaces:
 * a parse and a new print would round a large number, sort number keys and drop a twice-named key.
 */
export function prettyJson(text: string): string | null {
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  let out = "";
  let depth = 0;
  let previous = "";
  const newLine = (): string => `\n${"  ".repeat(depth)}`;
  for (const part of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\],:]|[^\s{}[\],:"]+/g)) {
    const token = part[0];
    if (token === "{" || token === "[") {
      depth += 1;
      out += token + newLine();
    } else if (token === "}" || token === "]") {
      depth -= 1;
      // An empty object or list stays on one line.
      out = previous === "{" || previous === "[" ? out.trimEnd() + token : out + newLine() + token;
    } else if (token === ",") out += token + newLine();
    else if (token === ":") out += ": ";
    else out += token;
    previous = token;
  }
  return out;
}

/** A browser draws a span for each token: past this size, the page slows for seconds. */
export const maxColouredLength = 200_000;

const patterns = new Map<Grammar, RegExp>();
/** Sticky, so the check reads on from the string's end without a copy of the rest of the file. */
const colonAfter = /\s*:/y;

function patternOf(grammar: Grammar): RegExp {
  const cached = patterns.get(grammar);
  if (cached !== undefined) return cached;
  const parts = [
    grammar.comments.length > 0 ? `(?<comment>${grammar.comments.join("|")})` : null,
    grammar.tags === true ? String.raw`(?<tag></?[A-Za-z][\w:.-]*|/?>)` : null,
    `(?<string>${grammar.strings.join("|")})`,
    String.raw`(?<number>\b(?:0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b)`,
    String.raw`(?<word>[A-Za-z_$][\w$]*)`,
  ];
  const pattern = new RegExp(parts.filter((part) => part !== null).join("|"), "g");
  patterns.set(grammar, pattern);
  return pattern;
}

/** The text of the file in tokens. Joined again, they give back the whole text. */
export function codeTokens(path: string, text: string): CodeToken[] {
  const grammar = grammars[grammarOfExtension[extensionOf(path)] ?? ""];
  if (grammar === undefined || text.length > maxColouredLength) return [{ kind: "plain", text }];
  const tokens: CodeToken[] = [];
  const push = (kind: TokenKind, part: string): void => {
    if (part === "") return;
    const last = tokens.at(-1);
    // Plain words and spaces join, so a large file gives far fewer parts to draw.
    if (kind === "plain" && last?.kind === "plain") tokens[tokens.length - 1] = { kind, text: last.text + part };
    else tokens.push({ kind, text: part });
  };
  let end = 0;
  for (const match of text.matchAll(patternOf(grammar))) {
    push("plain", text.slice(end, match.index));
    end = match.index + match[0].length;
    const { word, string, comment, tag } = match.groups ?? {};
    if (word !== undefined) {
      push(grammar.keywords.has(grammar.anyCase === true ? word.toLowerCase() : word) ? "keyword" : "plain", word);
    } else if (string !== undefined) {
      colonAfter.lastIndex = end;
      push(grammar.keys === true && colonAfter.test(text) ? "key" : "string", string);
    } else if (comment !== undefined) push("comment", comment);
    else if (tag !== undefined) push("tag", tag);
    else push("number", match[0]);
  }
  push("plain", text.slice(end));
  return tokens;
}
