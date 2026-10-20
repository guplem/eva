/**
 * The schedules a person wants, in `.eva/schedules.json` in the vault
 * (lesson 64). A person and the agent both edit this file, so a read never throws: a bad
 * entry is skipped with a sentence that says why, and the other entries still run (lesson 69).
 */
import { readFileSync } from "node:fs";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";
import { EvaError } from "../../shared/errors.ts";

export const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayName = (typeof dayNames)[number];

export interface Schedule {
  /** State is keyed by the id, so an id never changes and is never reused (lesson 65). */
  readonly id: string;
  readonly name: string;
  /** `HH:MM` on the wall clock of the configured time zone (lesson 68). */
  readonly at: string;
  /** Day numbers as `Date.getUTCDay` counts them: 0 is Sunday. */
  readonly days: readonly number[];
  readonly text: string | null;
  /** A path from the vault root. */
  readonly file: string | null;
  readonly prompt: string | null;
  readonly model: string | null;
  /** False while the person paused the schedule. A file without the field means on. */
  readonly enabled: boolean;
}

export interface ScheduleDefinitions {
  readonly schedules: readonly Schedule[];
  /** One sentence for each skipped entry, or for a file that could not be read. */
  readonly problems: readonly string[];
}

/** The order of the fields in a setup card. */
export const scheduleFieldOrder = ["id", "name", "at", "days", "text", "file", "prompt", "model"] as const;
export type ScheduleFieldName = (typeof scheduleFieldOrder)[number];
/** What a card names as changed. `enabled` is no field of a card, so a pause never changes `announcedFields` (lesson 66). */
export type ScheduleChange = ScheduleFieldName | "enabled";

const formatVersion = 1;
/** The id travels in Telegram button data, which Telegram caps at 64 bytes. */
const idPattern = /^[a-z0-9-]{1,32}$/;
const timePattern = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
/** Telegram refuses a topic name over 128 characters. */
const nameLimit = 128;

export function readScheduleDefinitions(path: string): ScheduleDefinitions {
  const read = readJsonTolerant(path);
  if (!read.ok) {
    return read.reason === "missing"
      ? { schedules: [], problems: [] }
      : { schedules: [], problems: ["The schedules file could not be read as JSON."] };
  }
  const file = read.value as { version?: unknown; schedules?: unknown } | null;
  if (file?.version !== formatVersion) {
    return { schedules: [], problems: [`The schedules file is not format version ${String(formatVersion)}.`] };
  }
  if (!Array.isArray(file.schedules)) return { schedules: [], problems: ["The schedules file holds no list."] };
  const schedules: Schedule[] = [];
  const problems: string[] = [];
  file.schedules.forEach((entry: unknown, index: number) => {
    const parsed = parseScheduleEntry(entry, index + 1);
    if (typeof parsed === "string") problems.push(parsed);
    else if (schedules.some((schedule) => schedule.id === parsed.id))
      problems.push(`Schedule ${String(index + 1)} uses the id ${parsed.id} twice, so it was skipped.`);
    else schedules.push(parsed);
  });
  return { schedules, problems };
}

/** A schedule, or the sentence that says why entry `position` was skipped. */
export function parseScheduleEntry(entry: unknown, position: number): Schedule | string {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry))
    return `Schedule ${String(position)} is not an object, so it was skipped.`;
  const fields = entry as Record<string, unknown>;
  const id = fields["id"];
  if (typeof id !== "string" || !idPattern.test(id))
    return `Schedule ${String(position)} has no valid id: use 1 to 32 lowercase letters, digits or dashes.`;
  const name = optionalText(fields["name"]);
  if (name === null) return `Schedule ${id} has no name, so it was skipped.`;
  const at = fields["at"];
  if (typeof at !== "string" || !timePattern.test(at))
    return `Schedule ${id} has no valid time: write it as HH:MM, such as 07:30.`;
  const days = parseDays(fields["days"]);
  if (days === null)
    return `Schedule ${id} has invalid days: list some of ${dayNames.join(", ")}, or leave days out for every day.`;
  const text = optionalText(fields["text"]);
  const file = optionalText(fields["file"]);
  const prompt = optionalText(fields["prompt"]);
  if (text === null && file === null && prompt === null)
    return `Schedule ${id} has no text, file or prompt, so it does nothing.`;
  // Scratch empties after a week, so the file would be gone by a later firing.
  if (file?.replaceAll("\\", "/").split("/")[0] === "Scratch")
    return `Schedule ${id} sends a file from Scratch/: use a file outside Scratch/.`;
  const enabled = "enabled" in fields ? fields["enabled"] : true;
  // A typo such as "false" in quotes must never run a schedule that the person paused.
  if (typeof enabled !== "boolean") return `Schedule ${id} has an invalid enabled: write true or false.`;
  const model = optionalText(fields["model"]);
  return { id, name: name.slice(0, nameLimit), at, days, text, file, prompt, model, enabled };
}

/** Every field of a schedule as text, for a setup card and for change detection (lesson 66). */
export function announcedFields(schedule: Schedule): Partial<Record<ScheduleFieldName, string>> {
  const values: Record<ScheduleFieldName, string | null> = {
    id: schedule.id,
    name: schedule.name,
    at: schedule.at,
    days: schedule.days.map((day) => dayNames[day]).join(", "),
    text: schedule.text,
    file: schedule.file,
    prompt: schedule.prompt,
    model: schedule.model,
  };
  const fields: Partial<Record<ScheduleFieldName, string>> = {};
  for (const name of scheduleFieldOrder) {
    const value = values[name];
    if (value !== null) fields[name] = value;
  }
  return fields;
}

export function changedFields(
  before: Partial<Record<ScheduleFieldName, string>>,
  after: Partial<Record<ScheduleFieldName, string>>,
): ScheduleFieldName[] {
  return scheduleFieldOrder.filter((name) => before[name] !== after[name]);
}

/** Adds a schedule, or replaces the one with the same id. Throws on an invalid entry. */
export function saveScheduleDefinition(path: string, entry: Readonly<Record<string, unknown>>): Schedule {
  const parsed = parseScheduleEntry(entry, 1);
  if (typeof parsed === "string") throw new EvaError("schedule_invalid", parsed);
  const file = readWritableFile(path);
  const index = file.schedules.findIndex((existing) => isEntryWithId(existing, parsed.id));
  if (index === -1) file.schedules.push(entry);
  else file.schedules[index] = entry;
  writeScheduleFile(path, file);
  return parsed;
}

/** Removes one schedule and keeps every other entry as it is. False when no entry has the id. */
export function removeScheduleDefinition(path: string, scheduleId: string): boolean {
  const file = readWritableFile(path);
  const kept = file.schedules.filter((entry) => !isEntryWithId(entry, scheduleId));
  if (kept.length === file.schedules.length) return false;
  writeScheduleFile(path, { ...file, schedules: kept });
  return true;
}

/** Turns one schedule off or on, and keeps every other key. False when no entry has the id. */
export function setScheduleEnabled(path: string, scheduleId: string, enabled: boolean): boolean {
  const file = readWritableFile(path);
  const index = file.schedules.findIndex((entry) => isEntryWithId(entry, scheduleId));
  const entry = file.schedules[index] as Record<string, unknown> | undefined;
  if (entry === undefined) return false;
  // On is the default, so the key leaves the entry and the file stays as the person wrote it.
  const { enabled: _old, ...rest } = entry;
  file.schedules[index] = enabled ? rest : { ...rest, enabled: false };
  writeScheduleFile(path, file);
  return true;
}

interface WritableScheduleFile {
  readonly [key: string]: unknown;
  readonly schedules: unknown[];
}

/** A file that a write can change safely. A broken file throws, so a guess never replaces it. */
function readWritableFile(path: string): WritableScheduleFile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { version: formatVersion, schedules: [] };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new EvaError("schedule_invalid", "The schedules file is not valid JSON. Fix it first.");
  }
  const file = value as { schedules?: unknown } | null;
  if (typeof file !== "object" || file === null || !Array.isArray(file.schedules))
    throw new EvaError("schedule_invalid", "The schedules file holds no list. Fix it first.");
  return file as WritableScheduleFile;
}

function writeScheduleFile(path: string, file: WritableScheduleFile): void {
  // Two spaces, as the schedule skill writes, so the autosave commit shows only the changed lines.
  writeFileAtomic(path, JSON.stringify(file, null, 2) + "\n");
}

function isEntryWithId(entry: unknown, scheduleId: string): boolean {
  return typeof entry === "object" && entry !== null && (entry as { id?: unknown }).id === scheduleId;
}

function parseDays(raw: unknown): number[] | null {
  if (raw === undefined || raw === null) return [0, 1, 2, 3, 4, 5, 6];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const days = new Set<number>();
  for (const day of raw) {
    const index = typeof day === "string" ? dayNames.indexOf(day.toLowerCase() as DayName) : -1;
    if (index === -1) return null;
    days.add(index);
  }
  return [...days].sort((first, second) => first - second);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
