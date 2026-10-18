/**
 * Finds which checks a list of shell commands runs: a format check, a lint or tests. The setup
 * report reads the commands from CI steps and git hooks. It must work for any stack, so it
 * knows tool names, not projects: an unknown tool counts as no check.
 */
export type CheckKind = "format" | "lint" | "test";

/**
 * Programs that run another program, or a subcommand that names the work: `npx eslint`,
 * `go test`, `python -m pytest`. Eva skips them to find the tool.
 */
const runners = new Set([
  "npx",
  "bunx",
  "pnpx",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "deno",
  "exec",
  "run",
  "uv",
  "uvx",
  "poetry",
  "pipenv",
  "pdm",
  "hatch",
  "python",
  "python3",
  "py",
  "go",
  "cargo",
  "dotnet",
  "mix",
  "mvn",
  "gradle",
  "gradlew",
  "make",
  "just",
  "bundle",
  "composer",
  "php",
  "env",
  "cross-env",
  "time",
  "playwright",
]);
const packageManagers = new Set(["npm", "pnpm", "yarn", "bun"]);
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
    const script = scriptCall(tokens, scripts);
    if (script !== null) {
      const body = Object.hasOwn(scripts, script) ? scripts[script] : undefined;
      if (body === undefined) {
        for (const kind of toolChecks(script, [])) found.add(kind);
      } else if (!visited.has(script) && visited.size < scriptDepthLimit) {
        collect(body, scripts, new Set([...visited, script]), found);
      }
      continue;
    }
    const start = tokens.findIndex((token) => !runners.has(baseName(token)) && !token.startsWith("-"));
    // A bare `test` is the shell's condition command, as in `if test -e file`; `go test` is not.
    if (start === -1 || (start === 0 && tokens[0] === "test")) continue;
    for (const kind of toolChecks(tokens[start] ?? "", tokens.slice(start + 1))) found.add(kind);
  }
}

/** Each simple command of a shell text, as its words, without leading variable assignments. */
function simpleCommands(text: string): string[][] {
  return text
    .replace(/\\\r?\n/g, " ")
    .split(/&&|\|\||[;|\r\n]/)
    .map((part) =>
      part
        .replace(/[()"']/g, " ")
        .trim()
        .split(/\s+/)
        .filter((token) => token !== ""),
    )
    .map((tokens) =>
      tokens.slice(
        Math.max(
          0,
          tokens.findIndex((token) => !/^\w+=/.test(token)),
        ),
      ),
    )
    .filter((tokens) => tokens.length > 0 && !(tokens[0] ?? "").startsWith("#"));
}

/** The script that a package manager runs: `npm run lint`, `npm test`, `pnpm lint`. Null: no script call. */
function scriptCall(tokens: readonly string[], scripts: Readonly<Record<string, string>>): string | null {
  const [manager = "", ...rest] = tokens;
  if (!packageManagers.has(manager)) return null;
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
  if (parts.some((part) => lintTools.has(part) || part.endsWith("lint"))) kinds.push("lint");
  if (parts.some((part) => testTools.has(part))) kinds.push("test");
  return kinds;
}

/** The last part of a path, such as `phpunit` for `vendor/bin/phpunit`. */
function baseName(token: string): string {
  return token.split(/[\\/]/).pop() ?? token;
}
