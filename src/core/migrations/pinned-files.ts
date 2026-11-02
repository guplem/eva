/**
 * On 2026-11-02 any vault file got `summary:` and `pinned:` (#769). Two old forms become the new one:
 *
 * - A project in the vault's `Projects/` with no `summary` gets one, with the text that the old
 *   projects block showed: the first paragraph after the title, at most 300 characters.
 * - A note whose first line under the title is `> Important: <why>` gets `pinned: summary`. With no
 *   `summary` yet, the reason moves into `summary:` and the line goes. Otherwise the line stays, so
 *   no text is lost.
 *
 * A file whose new front matter would not read as the old one stays as it is.
 * The migration is frozen: it holds its own copy of the description reader and the header edit.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse as parseYaml } from "yaml";
import type { Migration, MigrationContext } from "./migration-runner.ts";

/** A note larger than this is a document or a dump, not a note that the old rule marked. */
const maxNoteBytes = 1_000_000;
const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
/** A frozen copy of the project id rule of `src/core/projects/project-id.ts`: an old id can hold only a year. */
const projectIdPattern = /^\d{4}(?:-\d{2}(?:-\d{2}(?:-\d{4})?)?)?-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** #770 owns the About me note and its `pinned: full`. */
const aboutMePath = "Life/About me.md";
/** The walk runs once, on the hub, at start; a vault with more entries than this is not a notes vault. */
const maxVisitedEntries = 200_000;

export const pinFiles: Migration = {
  id: "2026-11-02-pinned-files",
  store: "vault",
  run: (context) => {
    const vaultPath = context.vaultPath;
    if (vaultPath === null || !existsSync(vaultPath)) return "later";
    for (const path of markdownFiles(vaultPath)) migrateFile(context, vaultPath, path);
    return "done";
  },
};

function migrateFile(context: MigrationContext, vaultPath: string, path: string): void {
  const absolute = join(vaultPath, path);
  let text: string;
  try {
    if (statSync(absolute).size > maxNoteBytes) return;
    text = readFileSync(absolute, "utf-8");
  } catch {
    return;
  }
  if (path === aboutMePath) return;
  let changed = text;
  const parts = path.split("/");
  const isProject =
    parts.length === 3 && parts[0] === "Projects" && projectIdPattern.test(parts[1] ?? "") && parts[2] === "AGENTS.md";
  if (isProject) changed = withProjectSummary(changed) ?? changed;
  changed = withImportantPin(changed) ?? changed;
  if (changed !== text) context.write(absolute, changed);
}

/** The project file with a quoted `summary`, or null when it needs none or the edit is unsafe. */
function withProjectSummary(text: string): string | null {
  const header = headerOf(text.replace(/^\uFEFF/, ""));
  if (header === null || header === "broken" || hasText(header["summary"])) return null;
  const description = readDescription(text.replace(/^\uFEFF/, ""));
  // A JSON string is a YAML string too, so `: `, ` #` and quotes stay one value.
  return description === null ? null : withHeaderField(text, "summary", `summary: ${JSON.stringify(description)}`);
}

/** The note with `pinned: summary` for its `> Important:` line, or null when it has none or the edit is unsafe. */
function withImportantPin(text: string): string | null {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const rest = text.slice(bom.length);
  const header = headerOf(rest);
  if (header === "broken" || (header !== null && "pinned" in header)) return null;
  const match = frontMatterPattern.exec(rest);
  const bodyStart = match === null ? 0 : match[0].length;
  const body = rest.slice(bodyStart);
  const heading = titleHeading(body);
  const afterTitle = heading === null ? 0 : heading.index + heading.length;
  // The empty lines before it, the whole quote with its reason, and its line break.
  const line = /^((?:[ \t]*\r?\n)*)([ \t]*>[ \t]*Important:[^\r\n]*(?:\r?\n[ \t]*>[^\r\n]*)*)(?:\r?\n|$)/.exec(
    body.slice(afterTitle),
  );
  if (line === null) return null;
  const why = (line[2] ?? "")
    .split(/\r?\n/)
    .map((each) => each.trim().replace(/^>\s?/, ""))
    .join(" ")
    .replace(/^\s*Important:/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (why === "") return null;
  let edited = rest;
  if (header === null || !hasText(header["summary"])) {
    // The line and the empty line after it go; the reason lives on in `summary:`.
    const base = bodyStart + afterTitle;
    const lineStart = base + (line[1] ?? "").length;
    let lineEnd = base + line[0].length;
    const blank = /^[ \t]*\r?\n/.exec(rest.slice(lineEnd));
    if (blank !== null) lineEnd += blank[0].length;
    edited = rest.slice(0, lineStart) + rest.slice(lineEnd);
    const withSummary = withHeaderField(edited, "summary", `summary: ${JSON.stringify(why)}`);
    if (withSummary === null) return null;
    edited = withSummary;
  }
  const pinned = withHeaderField(edited, "pinned", "pinned: summary");
  return pinned === null ? null : bom + pinned;
}

/** An empty `summary:` counts as none. */
function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Every `.md` file of the vault, with no hidden folder, no root `Scratch/`, no clone, no
 * `node_modules` and no link.
 */
function markdownFiles(vaultPath: string): string[] {
  const files: string[] = [];
  const queue: string[] = [""];
  let left = maxVisitedEntries;
  for (let folder = queue.shift(); folder !== undefined; folder = queue.shift()) {
    let entries;
    try {
      entries = readdirSync(join(vaultPath, folder), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      left -= 1;
      if (left < 0) return files;
      if (entry.name.startsWith(".")) continue;
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      const parts = path.toLowerCase().split("/");
      if (entry.isDirectory()) {
        const skipped =
          (parts.length === 1 && parts[0] === "scratch") ||
          entry.name.toLowerCase() === "node_modules" ||
          (parts.length === 3 && parts[0] === "projects" && parts[2] === "repos");
        if (!skipped) queue.push(path);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(path);
    }
  }
  return files;
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function headerOf(text: string): Record<string, unknown> | null | "broken" {
  const match = frontMatterPattern.exec(text);
  if (match === null) return null;
  try {
    const header: unknown = parseYaml(match[1] ?? "", { schema: "failsafe" });
    return isMap(header) ? header : null;
  } catch {
    return "broken";
  }
}

/** A frozen copy of `withHeaderField` of `src/core/vault/about-me.ts`, as it was on 2026-11-02. */
function withHeaderField(text: string, key: string, line: string): string | null {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const rest = text.slice(bom.length);
  const before = headerOf(rest);
  if (before === "broken") return null;
  const opening = /^---\r?\n/.exec(rest);
  const newline = (opening?.[0] ?? rest).includes("\r\n") ? "\r\n" : "\n";
  const match = frontMatterPattern.exec(rest);
  if (opening === null) return `${bom}---${newline}${line}${newline}---${newline}${rest}`;
  const empty = /^---\r?\n---(\r?\n|$)/.test(rest);
  if (match === null && !empty) return null;
  const headerEnd = empty ? opening[0].length : opening[0].length + (match?.[1] ?? "").length;
  const lines = empty ? [] : rest.slice(opening[0].length, headerEnd).split(/\r?\n/);
  const start = lines.findIndex((each) => each === `${key}:` || each.startsWith(`${key}: `));
  if (start === -1) lines.push(line);
  else {
    let end = start + 1;
    while (end < lines.length && /^(\s|$|-(\s|$))/.test(lines[end] ?? "")) end += 1;
    while (end > start + 1 && (lines[end - 1] ?? "").trim() === "") end -= 1;
    lines.splice(start, end - start, line);
  }
  const header = lines.join(newline);
  const changed = empty
    ? `${opening[0]}${header}${newline}${rest.slice(opening[0].length)}`
    : `${rest.slice(0, opening[0].length)}${header}${rest.slice(headerEnd)}`;
  const after = headerOf(changed);
  if (!isMap(after) || !(key in after)) return null;
  const old = before ?? {};
  const others = new Set([...Object.keys(old), ...Object.keys(after)].filter((each) => each !== key));
  for (const other of others) if (!isDeepStrictEqual(old[other], after[other])) return null;
  return bom + changed;
}

const blockStartPattern = /^(#|>|\||<|!\[|\[!\[|[*+-]\s|[-*_]{3,}|```|~~~|\d+[.)]\s)/;
const descriptionLimit = 300;

/** A frozen copy of `readDescription` of `src/core/projects/project-catalog.ts`, as it was on 2026-11-02. */
function readDescription(text: string): string | null {
  const body = text.replace(frontMatterPattern, "");
  const heading = titleHeading(body);
  const rest = heading === null ? body : body.slice(heading.index + heading.length);
  const lines = rest.split("\n").map((line) => line.trim());
  const start = lines.findIndex((line) => line.length > 0);
  if (start === -1 || blockStartPattern.test(lines[start] ?? "")) return null;
  const end = lines.findIndex((line, index) => index > start && (line.length === 0 || blockStartPattern.test(line)));
  const plain = lines
    .slice(start, end === -1 ? undefined : end)
    .join(" ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length === 0) return null;
  return plain.length <= descriptionLimit ? plain : `${plain.slice(0, descriptionLimit - 1).trimEnd()}…`;
}

/** A frozen copy of `titleHeading` of `src/core/projects/project-catalog.ts`, as it was on 2026-11-02. */
function titleHeading(body: string): { readonly index: number; readonly length: number } | null {
  let fence: string | null = null;
  let index = 0;
  for (const line of body.split("\n")) {
    const content = line.replace(/\r$/, "");
    const marker = /^ {0,3}(`{3,}(?!.*`)|~{3,})/.exec(content)?.[1];
    if (marker !== undefined && fence === null) fence = marker;
    else if (
      marker?.[0] === fence?.[0] &&
      (marker?.length ?? 0) >= (fence?.length ?? 0) &&
      /^ {0,3}[`~]+\s*$/.test(content)
    ) {
      fence = null;
    } else if (fence === null && content.startsWith("# ") && content.trim().length > 1) {
      return { index, length: content.length };
    }
    index += line.length + 1;
  }
  return null;
}
