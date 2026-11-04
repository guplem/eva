/**
 * On 2026-11-04 the project status became the work only: active, paused or closed. A new key,
 * `in-use: true`, says that the person uses the project, whatever its status (#859). This
 * migration rewrites the status of each vault project: `in-use` becomes `closed` with
 * `in-use: true`, and `idea` becomes `paused`. It writes no `closed` date: Eva does not know the
 * day. It also replaces Eva's old lists of statuses in the comment after `status:`. It changes no
 * other line, and skips a file with a broken front matter.
 *
 * The vault map's _Projects_ text changes in vault structure v6, with the person.
 *
 * The migration is frozen: it holds its own copy of the old and the new values.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Migration, MigrationContext } from "./migration-runner.ts";

const frontMatterPattern = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/;
/** A frozen copy of the project id rule of `src/core/projects/project-id.ts`: an old id can hold only a year. */
const projectIdPattern = /^\d{4}(?:-\d{2}(?:-\d{2}(?:-\d{4})?)?)?-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The top-level status line: the key, the value with its quotes, and the rest, such as a comment. */
const statusLinePattern = /^(status\s*:\s*)(["']?)([^"'\s#]*)\2(.*)$/;

const newStatuses: Readonly<Record<string, string>> = { "in-use": "closed", idea: "paused" };
const oldLists: readonly string[] = ["idea, active, paused or closed", "idea, active, in-use, paused or closed"];
const newList = "active, paused or closed";

export const splitProjectInUse: Migration = {
  id: "2026-11-04-project-in-use",
  store: "vault",
  run: (context) => {
    const vaultPath = context.vaultPath;
    if (vaultPath === null || !existsSync(vaultPath)) return "later";
    const projects = join(vaultPath, "Projects");
    for (const name of folderNames(projects).filter((name) => projectIdPattern.test(name)))
      splitProject(context, join(projects, name, "AGENTS.md"));
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

function splitProject(context: MigrationContext, path: string): void {
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
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(newline);
  const index = lines.findIndex((line) => statusLinePattern.test(line));
  const parts = index === -1 ? null : statusLinePattern.exec(lines[index] ?? "");
  if (parts === null) return;
  const [, key = "", quote = "", status = "", rest = ""] = parts;
  const comment = /^(\s*#\s*)(.*?)\s*$/.exec(rest);
  const newRest = comment !== null && oldLists.includes(comment[2] ?? "") ? `${comment[1] ?? ""}${newList}` : rest;
  const newStatus = Object.hasOwn(newStatuses, status) ? (newStatuses[status] ?? status) : status;
  const newLine = `${key}${quote}${newStatus}${quote}${newRest}`;
  if (newLine === lines[index]) return;
  lines[index] = newLine;
  if (status === "in-use") {
    // The old status wins over a flag that says no, as Eva reads it: the person used the project.
    const flag = lines.findIndex((line) => /^in-use\s*:/.test(line));
    if (flag === -1) lines.splice(index + 1, 0, "in-use: true");
    else if (!/^in-use\s*:\s*["']?true["']?\s*(#.*)?$/i.test(lines[flag] ?? "")) lines[flag] = "in-use: true";
  }
  context.write(path, `${match[1] ?? ""}${lines.join(newline)}${match[3] ?? ""}${text.slice(match[0].length)}`);
}
