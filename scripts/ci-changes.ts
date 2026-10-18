/**
 * Tells the CI workflow if a pull request changes code, or only docs (#103).
 * It writes `code_changed=true|false` to `$GITHUB_OUTPUT`. The code-only jobs skip their work on `false`.
 * Any doubt gives `true`: a wrong "code" costs a slow run, a wrong "docs" skips real checks.
 */
import { appendFileSync } from "node:fs";
import { basename } from "node:path";

// Markdown in these folders can ship inside the executable or feed a test, such as the
// assistant prompt. Agent instructions in them are docs: Eva never reads her own.
const agentFiles = new Set(["AGENTS.md", "CLAUDE.md"]);
const codeFolders = ["src/", "test/"];

export function isDocsPath(path: string): boolean {
  if (!path.endsWith(".md")) return false;
  // Every file of the vault template ships inside the executable, its AGENTS.md too.
  if (path.startsWith("templates/")) return false;
  if (agentFiles.has(basename(path))) return true;
  return !codeFolders.some((folder) => path.startsWith(folder));
}

export function codeChanged(paths: readonly string[]): boolean {
  return paths.length === 0 || !paths.every(isDocsPath);
}

// A pull request run checks out the merge commit, so its first parent is the base branch.
// `--no-renames` lists both paths of a move, so a file moved out of `src/` counts as code.
function changedPaths(): string[] {
  const result = Bun.spawnSync(["git", "diff", "--name-only", "--no-renames", "-z", "HEAD^1", "HEAD"], {
    stdout: "pipe",
    stderr: "inherit",
    timeout: 30_000,
  });
  if (result.exitCode !== 0) throw new Error(`git diff failed with exit code ${String(result.exitCode)}.`);
  return result.stdout
    .toString()
    .split("\0")
    .filter((path) => path.length > 0);
}

function decide(): boolean {
  if (process.env["GITHUB_EVENT_NAME"] !== "pull_request") return true;
  try {
    return codeChanged(changedPaths());
  } catch (error) {
    process.stderr.write(`${String(error)} The full set runs.\n`);
    return true;
  }
}

if (import.meta.main) {
  const changed = decide();
  process.stdout.write(
    changed ? "Code changed: the full set runs.\n" : "Only docs changed: the code-only work skips.\n",
  );
  const output = process.env["GITHUB_OUTPUT"];
  if (output !== undefined) appendFileSync(output, `code_changed=${String(changed)}\n`);
}
