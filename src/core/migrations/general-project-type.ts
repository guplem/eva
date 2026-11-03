/**
 * On 2026-11-02 a project got a third type, general, and no `type` key means general when the
 * project lists no repository (#768). A project with `repos` and no type still reads as software,
 * but the key makes that clear to a person and to an agent. So this migration writes
 * `type: software` into each vault project with `repos` and no `type`. It changes nothing else in
 * that file, and skips a file with a broken front matter. A folder of `Projects/` whose name is no
 * project id is no project, so it stays as it is.
 *
 * It also fixes the vault map's _Projects_ section where Eva's exact text is still there: the
 * comment of the type line, the count of types, and a General bullet above Eva's Software bullet.
 * Each line that the person changed stays as it is.
 *
 * The migration is frozen: it holds its own copy of the old and the new text.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Migration, MigrationContext } from "./migration-runner.ts";

const frontMatterPattern = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/;
/** A frozen copy of the project id rule of `src/core/projects/project-id.ts`: an old id can hold only a year. */
const projectIdPattern = /^\d{4}(?:-\d{2}(?:-\d{2}(?:-\d{4})?)?)?-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const mapLines: readonly (readonly [string, string])[] = [
  [
    "type: software # software or specialist. No type means software",
    "type: software # general, software or specialist. No type means general",
  ],
  ["A project is one of two types:", "A project is one of three types:"],
];
const softwareBullet =
  "- **Software:** work in repositories, such as an app, a website or a widget. The text under the front matter describes the project for the person and for you. It names the repository to read first. The rules for the code live in each repository's own `AGENTS.md`. The project's notes sit beside the file.";
const generalBullet =
  "- **General:** a folder of notes and files, such as plans, reference photos or drafts: building a house, a scale model, a book. The text under the front matter describes the project.";

export const typeSoftwareProjects: Migration = {
  id: "2026-11-02-general-project-type",
  store: "vault",
  run: (context) => {
    const vaultPath = context.vaultPath;
    if (vaultPath === null || !existsSync(vaultPath)) return "later";
    const projects = join(vaultPath, "Projects");
    for (const name of folderNames(projects).filter((name) => projectIdPattern.test(name)))
      typeSoftwareProject(context, join(projects, name, "AGENTS.md"));
    fixVaultMap(context, join(vaultPath, "AGENTS.md"));
    return "done";
  },
};

function folderNames(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Adds `type: software` before the `repos` key of a project that lists repositories and has no type. */
function typeSoftwareProject(context: MigrationContext, path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return;
  }
  const match = frontMatterPattern.exec(text);
  if (match === null) return;
  const source = match[2] ?? "";
  let fields: unknown;
  try {
    fields = parseYaml(source, { schema: "failsafe" });
  } catch {
    return;
  }
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) return;
  const record = fields as Record<string, unknown>;
  const repos = record["repos"];
  if ("type" in record || !Array.isArray(repos) || repos.length === 0) return;
  if (!repos.every((repo) => typeof repo === "string")) return;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(newline);
  const reposLine = lines.findIndex((line) => /^repos\s*:/.test(line));
  if (reposLine === -1) return;
  lines.splice(reposLine, 0, "type: software");
  const head = `${match[1] ?? ""}${lines.join(newline)}${match[3] ?? ""}`;
  context.write(path, head + text.slice(match[0].length));
}

/** Replaces each of Eva's exact lines of the map, and adds the General bullet above Eva's Software bullet. */
function fixVaultMap(context: MigrationContext, path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf-8");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(newline);
  const fixed = lines.map((line) => mapLines.find(([old]) => old === line)?.[1] ?? line);
  const software = fixed.indexOf(softwareBullet);
  if (software !== -1 && !fixed.includes(generalBullet)) fixed.splice(software, 0, generalBullet);
  const result = fixed.join(newline);
  if (result !== text) context.write(path, result);
}
