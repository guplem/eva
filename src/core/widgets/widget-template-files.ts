/**
 * A Bun macro: it runs when Bun builds or loads `widget-template.ts`, and puts every file of
 * `templates/widget/` into the code as text. So the single executable carries the template, and
 * a new file of the template needs no import of its own.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The folders that a local `npm install` or test run makes, which git ignores. */
const skipped = new Set(["node_modules", "test-results", "playwright-report"]);

export function readWidgetTemplate(): Record<string, string> {
  const root = join(import.meta.dir, "..", "..", "..", "templates", "widget");
  const files: Record<string, string> = {};
  const walk = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (skipped.has(entry.name)) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else if (entry.isFile()) files[`${prefix}${entry.name}`] = readFileSync(path, "utf8");
    }
  };
  walk(root, "");
  return files;
}
