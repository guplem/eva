/**
 * On 2026-11-06 a moment in the vault got its UTC offset, such as `created: 2026-01-31T09:15+01:00`
 * (vault structure v7). With the offset, any reader converts the moment exactly to another zone.
 * This migration adds the offset to each old `created: YYYY-MM-DDTHH:mm` of a vault project. The
 * offset is the one of the `timeZone` setting on that day, so summer time counts. With no setting,
 * it is the zone of this computer, as for a new project. A day, such as `created: 2013-07-31`, stays.
 *
 * It changes only the `created` line, and keeps its quotes and its comment. It skips a file with a
 * broken front matter, and a value that is not a real time.
 *
 * It waits for `2026-11-03-format-settings`, which can move the time zone into the settings. It
 * waits as well while the settings file is broken.
 *
 * The migration is frozen: it holds its own copy of the project id rule and the offset helper.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { readJsonTolerant } from "../../shared/files.ts";
import type { Migration, MigrationContext } from "./migration-runner.ts";

const frontMatterPattern = /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/;
/** A frozen copy of the project id rule of `src/core/projects/project-id.ts`: an old id can hold only a year. */
const projectIdPattern = /^\d{4}(?:-\d{2}(?:-\d{2}(?:-\d{4})?)?)?-[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The top-level `created` line with a time and no offset: the key, the quote, the time, and the rest. */
const createdLinePattern = /^(created\s*:\s*)(["']?)(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})\2(\s*(?:#.*)?)$/;
/** The migration that moves the time zone into the settings, copied here to stay frozen. */
const formatSettingsId = "2026-11-03-format-settings";

export const addCreatedOffsets: Migration = {
  id: "2026-11-06-project-created-offset",
  store: "vault",
  run: (context) => {
    const vaultPath = context.vaultPath;
    if (vaultPath === null || !existsSync(vaultPath)) return "later";
    if (!formatSettingsDone(vaultPath)) return "later";
    const timeZone = settingsZone(vaultPath);
    if (timeZone === undefined) return "later";
    const projects = join(vaultPath, "Projects");
    for (const name of folderNames(projects).filter((name) => projectIdPattern.test(name)))
      addOffset(context, join(projects, name, "AGENTS.md"), timeZone);
    return "done";
  },
};

/**
 * The zone of the settings, else the zone of this computer. Undefined while the settings file is
 * broken: the person or the agent repairs it first.
 */
function settingsZone(vaultPath: string): string | undefined {
  const read = readJsonTolerant(join(vaultPath, ".eva", "settings", "settings.json"));
  if (!read.ok && read.reason !== "missing") return undefined;
  const value = read.ok && isObject(read.value) ? read.value["timeZone"] : undefined;
  if (read.ok && !isObject(read.value)) return undefined;
  return typeof value === "string" && isTimeZone(value) ? value : Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function formatSettingsDone(vaultPath: string): boolean {
  const read = readJsonTolerant(join(vaultPath, ".eva", "migrations.json"));
  if (!read.ok || !isObject(read.value)) return false;
  const applied = read.value["applied"];
  return Array.isArray(applied) && applied.some((entry) => isObject(entry) && entry["id"] === formatSettingsId);
}

function addOffset(context: MigrationContext, path: string, timeZone: string): void {
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
  const index = lines.findIndex((line) => createdLinePattern.test(line));
  const parts = index === -1 ? null : createdLinePattern.exec(lines[index] ?? "");
  if (parts === null) return;
  const [, key = "", quote = "", ...rest] = parts;
  const [year, month, day, hour, minute] = rest.slice(0, 5).map(Number);
  const wallClock = `${parts[3] ?? ""}-${parts[4] ?? ""}-${parts[5] ?? ""}T${parts[6] ?? ""}:${parts[7] ?? ""}`;
  // The line must be the value that a reader sees, not a line inside a block of text.
  if ((fields as Record<string, unknown>)["created"] !== wallClock) return;
  const wallMs = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0, hour ?? 0, minute ?? 0);
  // A time that is not on the clock, such as 25:75, rolls over to another day: it stays as it is.
  if (new Date(wallMs).toISOString().slice(0, 16) !== wallClock) return;
  lines[index] =
    `${key}${quote}${wallClock}${offsetText(offsetOfWallClock(wallMs, timeZone))}${quote}${parts[8] ?? ""}`;
  context.write(path, `${match[1] ?? ""}${lines.join(newline)}${match[3] ?? ""}${text.slice(match[0].length)}`);
}

/**
 * The offset in minutes of the zone at a wall clock, given as if it were UTC. The offset at the
 * wall clock read as UTC is close; the offset at the moment that it gives is the right one, also
 * on the day of a change to summer time.
 */
function offsetOfWallClock(wallMs: number, timeZone: string): number {
  const first = offsetAt(wallMs, timeZone);
  return offsetAt(wallMs - first * 60_000, timeZone);
}

function offsetAt(moment: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(moment));
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((item) => item.type === type)?.value);
  const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  return Math.round((wall - Math.floor(moment / 60_000) * 60_000) / 60_000);
}

/** `+01:00`, `-05:00` or `+00:00`: never `Z`, so every value has the same form. */
function offsetText(minutes: number): string {
  const size = Math.abs(minutes);
  const hours = String(Math.floor(size / 60)).padStart(2, "0");
  return `${minutes < 0 ? "-" : "+"}${hours}:${String(size % 60).padStart(2, "0")}`;
}

function folderNames(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isTimeZone(value: string): boolean {
  if (value.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
