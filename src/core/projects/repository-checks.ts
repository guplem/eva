/**
 * Finds which checks a list of shell commands runs: a format check, a lint or tests. The setup
 * report reads the commands from CI steps and git hooks. It must work for any stack, so it
 * knows tool names, not projects: an unknown tool counts as no check.
 */
export type CheckKind = "format" | "lint" | "test";

const packageManagers = new Set(["npm", "pnpm", "yarn", "bun"]);
/** Programs that print, move files or call a server. A tool name in their arguments runs nothing. */
const quietPrograms = new Set([
  ...["echo", "printf", "cd", "mkdir", "cp", "mv", "rm", "cat", "ls"],
  ...["export", "git", "curl", "wget", "tee", "touch", "chmod"],
]);
/** Words that install a tool, as in `npm install -D eslint` or `pip install pytest`. */
const installWords = new Set(["install", "add"]);
/** Shell words before a command. `test` after one of them is the shell's condition command. */
const shellKeywords = new Set(["if", "elif", "while", "until", "then", "do", "else", "!"]);
const testTools = new Set([
  "test",
  "tests",
  "pytest",
  "jest",
  "vitest",
  "mocha",
  "phpunit",
  "rspec",
  "ava",
  "karma",
  "jasmine",
  "tox",
  "nox",
  "ctest",
  "nextest",
  "unittest",
]);
const lintTools = new Set(["linter", "ruff", "flake8", "clippy", "rubocop", "shellcheck", "vet", "mypy", "phpstan"]);
/** Names that end in `lint` but check no code. */
const notLintTools = new Set(["commitlint"]);
const formatTools = new Set(["format", "prettier", "black", "isort", "dprint", "csharpier", "stylua"]);
/** Tools whose subcommand picks the check, such as `ruff format` and `ruff check`. */
const toolsWithSubcommands: Readonly<Record<string, readonly CheckKind[]>> = {
  ruff: ["lint"],
  biome: ["format", "lint"],
};
/** A limit for nested script calls, so a long chain never runs for ever. */
const scriptDepthLimit = 10;

/** The checks that the commands run. A package script call counts as the commands of the script. */
export function checksOf(commands: readonly string[], scripts: Readonly<Record<string, string>>): Set<CheckKind> {
  const found = new Set<CheckKind>();
  for (const command of commands) collect(command, scripts, new Set(), found);
  return found;
}

function collect(
  text: string,
  scripts: Readonly<Record<string, string>>,
  visited: ReadonlySet<string>,
  found: Set<CheckKind>,
): void {
  for (const tokens of simpleCommands(text)) {
    const first = baseName(tokens[0] ?? "");
    if (quietPrograms.has(first) || tokens.some((token) => installWords.has(token))) continue;
    const manager = tokens.findIndex((token) => packageManagers.has(token));
    const script = manager === -1 ? null : scriptCall(tokens.slice(manager), scripts);
    if (script !== null) {
      collectScript(script, scripts, visited, found);
      continue;
    }
    for (const kind of firstToolChecks(tokens)) found.add(kind);
  }
}

/** A script runs with its `pre` and `post` scripts, as npm runs them. A missing script counts by its name. */
function collectScript(
  script: string,
  scripts: Readonly<Record<string, string>>,
  visited: ReadonlySet<string>,
  found: Set<CheckKind>,
): void {
  const body = scriptBody(scripts, script);
  if (body === undefined) {
    for (const kind of nameChecks(script)) found.add(kind);
    return;
  }
  if (visited.has(script) || visited.size >= scriptDepthLimit) return;
  const inside = new Set([...visited, script]);
  for (const part of [scriptBody(scripts, `pre${script}`), body, scriptBody(scripts, `post${script}`)]) {
    if (part !== undefined) collect(part, scripts, inside, found);
  }
}

function scriptBody(scripts: Readonly<Record<string, string>>, name: string): string | undefined {
  return Object.hasOwn(scripts, name) ? scripts[name] : undefined;
}

/**
 * The checks of the first word that names a tool. A wrapper, such as `xargs`, `timeout 60` or
 * `go`, names no tool, so the scan passes it. The scan stops at the first tool, so in
 * `eslint src test` the folder `test` is not a test run.
 */
function firstToolChecks(tokens: readonly string[]): readonly CheckKind[] {
  for (const [index, token] of tokens.entries()) {
    if (token.startsWith("-") || token.startsWith("$") || token.includes("=")) continue;
    if ((token === "test" || token === "[") && (index === 0 || shellKeywords.has(tokens[index - 1] ?? ""))) return [];
    const kinds = toolChecks(token, tokens.slice(index + 1));
    if (kinds.length > 0) return kinds;
  }
  return [];
}

/** Each simple command of a shell text, as its words, without comments. */
function simpleCommands(text: string): string[][] {
  return text
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/(?:^|\s)#.*$/, ""))
    .join("\n")
    .split(/&&|\|\||[;|\n]/)
    .map((part) =>
      part
        .replace(/[()"']/g, " ")
        .trim()
        .split(/\s+/)
        .filter((token) => token !== ""),
    )
    .filter((tokens) => tokens.length > 0);
}

/** The script that a package manager runs: `npm run lint`, `npm test`, `pnpm lint`. Null: no script call. */
function scriptCall(tokens: readonly string[], scripts: Readonly<Record<string, string>>): string | null {
  const [manager = "", ...rest] = tokens;
  const words = rest.filter((token) => !token.startsWith("-"));
  const [first = ""] = words;
  if (first === "run" || first === "run-script") return words[1] ?? null;
  // `bun test` is Bun's own test runner, not the `test` script.
  if ((first === "test" || first === "t") && manager !== "bun") return "test";
  if (manager !== "npm" && first !== "test" && Object.hasOwn(scripts, first)) return first;
  return null;
}

function toolChecks(tool: string, rest: readonly string[]): readonly CheckKind[] {
  const name = baseName(tool);
  const subcommands = Object.hasOwn(toolsWithSubcommands, name) ? toolsWithSubcommands[name] : undefined;
  if (subcommands !== undefined) {
    const subcommand = rest.find((token) => !token.startsWith("-")) ?? "";
    return subcommand === "format" || subcommand === "lint" ? nameChecks(subcommand) : subcommands;
  }
  return nameChecks(name);
}

/** The checks that a tool name shows, part by part: `eslint`, `test:e2e`, `golangci-lint-action@v6`. */
function nameChecks(name: string): CheckKind[] {
  const parts = name.toLowerCase().split(/[-_:.@]/);
  const kinds: CheckKind[] = [];
  if (parts.some((part) => formatTools.has(part) || part.endsWith("fmt"))) kinds.push("format");
  if (parts.some((part) => lintTools.has(part) || (part.endsWith("lint") && !notLintTools.has(part)))) {
    kinds.push("lint");
  }
  if (parts.some((part) => testTools.has(part))) kinds.push("test");
  return kinds;
}

/** The last part of a path, such as `phpunit` for `vendor/bin/phpunit`. */
function baseName(token: string): string {
  return token.split(/[\\/]/).pop() ?? token;
}
