/**
 * A Bun macro: it runs when Bun builds or loads `widget-template.ts`, and puts every file of
 * `templates/widget/` into the code as text. So the single executable carries the template, and
 * a new file of the template needs no import of its own.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The folders that a local install or test run makes. Eva's own `.gitignore` lists them. */
const alwaysSkipped = ["node_modules", "test-results", "playwright-report"];

/** A test gives another folder; the macro call gives none. */
export function readWidgetTemplate(
  root: string = join(import.meta.dir, "..", "..", "..", "templates", "widget"),
): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (folder: string, prefix: string, ignored: readonly RegExp[]): void => {
    // A git-ignored file, such as a `.env` or a pskill run, must never reach a new public repository.
    const here = [...ignored, ...ignorePatterns(join(folder, ".gitignore"))];
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (here.some((pattern) => pattern.test(entry.name))) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`, here);
      else if (entry.isFile()) files[`${prefix}${entry.name}`] = readFileSync(path, "utf8");
    }
  };
  walk(
    root,
    "",
    alwaysSkipped.map((name) => namePattern(name)),
  );
  return files;
}

/** The name patterns of a `.gitignore`: the template's files list names only, such as `.env.*` or `runs/`. */
function ignorePatterns(path: string): RegExp[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\/$/, ""))
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map(namePattern);
}

function namePattern(glob: string): RegExp {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${body}$`);
}
