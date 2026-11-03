/**
 * On 2026-11-03 the answer language, the units, the clock and the first day of the week became Eva
 * settings, beside the time zone (#770). This migration moves them out of `Life/About me.md`:
 *
 * - A valid `units`, `clock` or `weekStart` of the header goes to the settings when the setting is
 *   empty. The field leaves the header, so the fact has one home. An empty field leaves too. A bad
 *   value stays, so nothing is lost, and the problem note asks the agent to move it.
 * - The `- **Language for answers:** …` line goes to `language`, and the `- **Time zone:** …` line
 *   goes to `timeZone`, when the setting is empty. Both lines leave the body.
 * - The header gets `pinned: full` when it has no `pinned` key, so Eva reads the note in every chat.
 *
 * Every other byte of the note stays, the old personal fields (`sleep`, `people`, `dates`, `diet`,
 * `allergies`) included: the vault upgrade files them with the person. A line whose value could not
 * be copied stays too, so nothing is lost. The migration writes no other file under `Life/`.
 *
 * It waits for `2026-10-30-settings-folder`, which copies the old `.eva/settings.json` to its new
 * place: before it, the new file is missing, and a write would hide the person's settings. It
 * waits as well while the note's header is broken, so the move runs after the repair.
 *
 * The migration is frozen: it holds its own key list, ids and header edits.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse as parseYaml } from "yaml";
import { readJsonTolerant } from "../../shared/files.ts";
import { parseConfig } from "../settings/home.ts";
import type { Migration, MigrationContext } from "./migration-runner.ts";

type JsonObject = Record<string, unknown>;

const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const validValues: Readonly<Record<string, readonly string[]>> = {
  units: ["metric", "imperial"],
  clock: ["24h", "12h"],
  weekStart: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
};
const pinnedLine = "pinned: full # full, summary or false. full: Eva reads this whole note in every chat";
const languageLine = /^- \*\*Language for answers:\*\*([^\r\n]*)(?:\r?\n|$)/m;
const timeZoneLine = /^- \*\*Time zone:\*\*([^\r\n]*)(?:\r?\n|$)/m;
/** The migration that moves the settings file into `.eva/settings/`, copied here to stay frozen. */
const settingsFolderId = "2026-10-30-settings-folder";

export const moveFormatSettings: Migration = {
  id: "2026-11-03-format-settings",
  store: "vault",
  run: (context) => {
    const vaultPath = context.vaultPath;
    if (vaultPath === null || !existsSync(vaultPath)) return "later";
    if (!settingsFolderDone(vaultPath)) return "later";
    const newFile = join(vaultPath, ".eva", "settings", "settings.json");
    const oldFile = join(vaultPath, ".eva", "settings.json");
    const read = readJsonTolerant(newFile);
    // A broken settings file waits: the person or the agent repairs it first.
    if (!read.ok && read.reason !== "missing") return "later";
    // Only an old file holds the settings: a new one would hide them.
    if (!read.ok && existsSync(oldFile)) return "later";
    if (read.ok && !isObject(read.value)) return "later";
    const settings: JsonObject = read.ok ? { ...(read.value as JsonObject) } : {};
    if (!isReadable(settings)) return "later";

    const notePath = join(vaultPath, "Life", "About me.md");
    if (!existsSync(notePath)) return "done";
    const text = readFileSync(notePath, "utf-8");
    const changed = migrateNote(text, settings);
    // A broken header waits for its repair, and a check that fails leaves the note as it is.
    if (changed === "broken") return "later";
    if (changed === null) return "done";
    if (!isReadable(changed.settings)) return "done";
    if (!isDeepStrictEqual(changed.settings, settings)) writeSettings(context, newFile, oldFile, changed.settings);
    if (changed.text !== text) context.write(notePath, changed.text);
    return "done";
  },
};

/** The note and the settings after the move. Null when the check fails, "broken" for a broken header. */
function migrateNote(text: string, before: JsonObject): { text: string; settings: JsonObject } | null | "broken" {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const rest = text.slice(bom.length);
  const header = headerOf(rest);
  if (header === "broken") return "broken";
  const settings = { ...before };
  // An empty header has no line between its two `---` lines, so the pattern does not match it.
  const match = frontMatterPattern.exec(rest) ?? /^---\r?\n---(?:\r?\n|$)/.exec(rest);
  let headerText = match === null ? null : rest.slice(0, match[0].length);
  let body = match === null ? rest : rest.slice(match[0].length);

  for (const key of Object.keys(validValues)) {
    if (header === null || !(key in header)) continue;
    const value = header[key];
    const valid = typeof value === "string" && (validValues[key] ?? []).includes(value);
    if (!valid && !isEmpty(value)) continue;
    if (valid && isUnset(settings[key])) settings[key] = value;
    headerText = headerText === null ? null : withoutField(headerText, key);
  }

  // A line leaves when it is empty, when its value is copied, or when the setting already holds one.
  // A value that the setting cannot take, such as an unknown zone, keeps its line, so nothing is lost.
  const lines: readonly [RegExp, string, (value: string) => boolean][] = [
    [languageLine, "language", (value) => value !== ""],
    [timeZoneLine, "timeZone", isTimeZone],
  ];
  for (const [pattern, key, accepts] of lines) {
    const line = pattern.exec(body);
    if (line === null) continue;
    const value = (line[1] ?? "").trim();
    if (value !== "" && isUnset(settings[key])) {
      if (!accepts(value)) continue;
      settings[key] = value;
    }
    body = body.slice(0, line.index) + body.slice(line.index + line[0].length);
  }

  const newline = (headerText ?? rest).includes("\r\n") ? "\r\n" : "\n";
  if (header === null || !("pinned" in header)) {
    headerText =
      headerText === null
        ? `---${newline}${pinnedLine}${newline}---${newline}`
        : headerText.replace(/(\r?\n)---(\r?\n|$)$/, `$1${pinnedLine}$1---$2`);
  }
  const changed = bom + (headerText ?? "") + body;
  return isSafe(header, headerOf(changed.slice(bom.length))) ? { text: changed, settings } : null;
}

/** True when the new header reads as the old one, with only the moved keys gone and `pinned` added. */
function isSafe(before: JsonObject | null, after: JsonObject | null | "broken"): boolean {
  if (after === null || after === "broken") return false;
  const old = before ?? {};
  for (const key of new Set([...Object.keys(old), ...Object.keys(after)])) {
    if (key in validValues && !(key in after)) continue;
    if (key === "pinned" && !("pinned" in old)) {
      if (after["pinned"] !== "full") return false;
      continue;
    }
    if (!isDeepStrictEqual(old[key], after[key])) return false;
  }
  return true;
}

/**
 * The header text without one top-level field and its own lines: indented lines, items of a list
 * and empty lines between them. The `---` lines stay.
 */
function withoutField(headerText: string, key: string): string {
  const lines = headerText.split(/(?<=\n)/);
  const start = lines.findIndex((line) => /^(.*?)\r?\n?$/.exec(line)?.[1] === `${key}:` || line.startsWith(`${key}: `));
  if (start <= 0) return headerText;
  let end = start + 1;
  while (end < lines.length - 1 && /^(\s|-(\s|$))/.test(lines[end] ?? "")) end += 1;
  while (end > start + 1 && (lines[end - 1] ?? "").trim() === "") end -= 1;
  // A comment line under the field may describe the next one, so it stays.
  const comments = lines.slice(start + 1, end).filter((line) => line.trim().startsWith("#"));
  return [...lines.slice(0, start), ...comments, ...lines.slice(end)].join("");
}

function headerOf(text: string): JsonObject | null | "broken" {
  const match = frontMatterPattern.exec(text);
  if (match === null) return null;
  try {
    const header: unknown = parseYaml(match[1] ?? "", { schema: "failsafe" });
    return isObject(header) ? header : null;
  } catch {
    return "broken";
  }
}

/**
 * Eva writes both places of the settings file while an older satellite may still read the old one.
 * The run starts from the new file, so the old one never gets a partial copy.
 */
function writeSettings(context: MigrationContext, newFile: string, oldFile: string, settings: JsonObject): void {
  const content = JSON.stringify(settings, null, 2) + "\n";
  if (existsSync(oldFile)) context.write(oldFile, content);
  context.write(newFile, content);
}

/** True once the settings folder migration is in the vault's record. A broken record counts as not yet. */
function settingsFolderDone(vaultPath: string): boolean {
  const read = readJsonTolerant(join(vaultPath, ".eva", "migrations.json"));
  if (!read.ok || !isObject(read.value)) return false;
  const applied = read.value["applied"];
  return Array.isArray(applied) && applied.some((entry) => isObject(entry) && entry["id"] === settingsFolderId);
}

function isReadable(settings: JsonObject): boolean {
  try {
    parseConfig(settings, "settings");
    return true;
  } catch {
    return false;
  }
}

function isTimeZone(value: string): boolean {
  if (value === "") return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Missing or null: a newer satellite can write `null` before the hub migrates. */
function isUnset(value: unknown): boolean {
  return value === undefined || value === null;
}

function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (isObject(value)) return Object.keys(value).length === 0;
  return value === undefined || value === null || value === "";
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
