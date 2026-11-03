/**
 * The person's basic facts, from the YAML header of `Life/About me.md`. Eva fills the header with
 * the vault's `about-me` skill, and code reads it here: the festive eyes, a greeting by name, and
 * later scripts such as a weather forecast. A bad field never breaks Eva: the reader ignores it and
 * names it, so Eva can fix it in her next turn.
 */
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse as parseYaml } from "yaml";
import { readJsonTolerant, readTextTolerant } from "../../shared/files.ts";
import { frontMatterPattern } from "../projects/project-catalog.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";
import { isClock, isUnits, isWeekStart, type Clock, type Units, type WeekStart } from "../../shared/time-format.ts";
import { moveFormatSettings } from "../migrations/format-settings.ts";
import { migrationApplied, vaultMigrationRecordPath } from "../migrations/migration-runner.ts";

const gitTimeoutMs = 20_000;

export type Hemisphere = "north" | "south";

/** The facts that code uses today. Null when the note does not say, or says it badly. */
export interface AboutMe {
  /** What Eva calls the person. */
  readonly name: string | null;
  /** `YYYY-MM-DD`. */
  readonly birthDate: string | null;
  /** An ISO 3166 code, such as `ES` or `ES-CT`: it picks the local days. */
  readonly region: string | null;
  readonly hemisphere: Hemisphere | null;
  /** One sentence for each field that Eva must fix. */
  readonly problems: readonly string[];
}

export const aboutMeFile = "Life/About me.md";

/** The keys of the header that the `about-me` skill describes. A rename is a change of a stored format. */
export const aboutMeHeaderKeys = [
  "name",
  "givenName",
  "familyName",
  "nickname",
  "pronouns",
  "birthDate",
  "contact",
  "region",
  "hemisphere",
  "places",
  "work",
  "languages",
  "lastLocation",
  "summary",
  "pinned",
  // Old personal fields, still valid until the vault upgrade (#773) files them with the person.
  "sleep",
  "people",
  "dates",
  "diet",
  "allergies",
] as const;

/** The header fields that became Eva settings on 2026-11-03 (#770). */
const movedFormatKeys = ["units", "clock", "weekStart"] as const;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const regionPattern = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;

const dateProblem = "must be a date as YYYY-MM-DD.";
/** A birthday may have no year, as `--MM-DD`: people often say only the day. */
const birthdayProblem = "must be a date as YYYY-MM-DD, or --MM-DD without the year.";
const timeProblem = "must be a time as HH:mm.";

function isRealDate(text: string): boolean {
  if (!datePattern.test(text)) return false;
  const date = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

/** A real date as `YYYY-MM-DD`, or a day of the year as `--MM-DD`. */
function isBirthday(text: string): boolean {
  const yearless = /^--(\d{2})-(\d{2})$/.exec(text);
  // 2000 is a leap year, so 29 February is a real day of the year.
  return yearless === null ? isRealDate(text) : isRealDate(`2000-${yearless[1] ?? ""}-${yearless[2] ?? ""}`);
}

/** Empty, also as an empty list or set: an agent or Obsidian writes `[]` for a field with nothing. */
function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object" && value !== null) return Object.keys(value).length === 0;
  return value === undefined || value === null || value === "";
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The header of the note: a map, null when the note has none, or "broken" when it is not YAML. The
 * failsafe schema keeps every value as text, so a date stays exactly as the person wrote it.
 */
function readHeader(vaultPath: string): Record<string, unknown> | null | "broken" {
  return headerOf(readTextTolerant(join(vaultPath, aboutMeFile)) ?? "");
}

function headerOf(text: string): Record<string, unknown> | null | "broken" {
  // A Windows editor can put a byte order mark before the header.
  const match = frontMatterPattern.exec(text.replace(/^\uFEFF/, ""));
  if (match === null) return null;
  try {
    const header: unknown = parseYaml(match[1] ?? "", { schema: "failsafe" });
    return isMap(header) ? header : null;
  } catch {
    return "broken";
  }
}

/** Reads the header and checks each field that the `about-me` skill describes. */
export function readAboutMe(vaultPath: string): AboutMe {
  const empty: AboutMe = { name: null, birthDate: null, region: null, hemisphere: null, problems: [] };
  const header = readHeader(vaultPath);
  if (header === "broken") return { ...empty, problems: [`The header of ${aboutMeFile} is not valid YAML.`] };
  if (header === null) return empty;

  const problems: string[] = [];
  const text1 = (key: string, valid: (value: string) => boolean, problem: string): string | null => {
    const value = header[key];
    if (isEmpty(value)) return null;
    if (typeof value === "string" && valid(value)) return value;
    problems.push(`${key} ${problem}`);
    return null;
  };

  const name = text1("name", (value) => value.trim() !== "", "must be a text.");
  const birthDate = text1("birthDate", isBirthday, birthdayProblem);
  const region = text1(
    "region",
    (value) => regionPattern.test(value),
    "must be a country code, such as ES, or a region code, such as ES-CT.",
  );
  const hemisphere = text1("hemisphere", (value) => value === "north" || value === "south", "must be north or south.");
  // Before the hub migrates, Eva still reads these fields, so the agent must not move them yet.
  if (migrationApplied(vaultMigrationRecordPath(vaultPath), moveFormatSettings.id))
    for (const key of movedFormatKeys)
      if (key in header)
        problems.push(
          `${key} is an Eva setting now: set it in Eva's Settings, or with eva settings set ${key}, then remove the field from this note.`,
        );
  checkHours(header, "sleep", problems);
  checkHours(header, "work", problems);
  if (!isEmpty(header["places"]) && !isMap(header["places"])) problems.push("places must be a set of named places.");
  checkDatedList(header, "people", "birthDate", false, problems);
  checkDatedList(header, "dates", "date", true, problems);
  for (const key of ["diet", "allergies"]) {
    if (!isEmpty(header[key]) && !Array.isArray(header[key])) problems.push(`${key} must be a list.`);
  }
  return { name, birthDate, region, hemisphere: hemisphere as Hemisphere | null, problems };
}

/** The format fields of the header before 2026-11-03 (#770). Null for a bad, empty or missing one. */
export interface OldFormatFields {
  readonly units: Units | null;
  readonly clock: Clock | null;
  readonly weekStart: WeekStart | null;
}

/**
 * The valid format fields of the header. A satellite reads them while the hub has not moved them
 * to the settings yet. Remove this one release after #770.
 */
export function readOldFormatFields(vaultPath: string): OldFormatFields {
  const header = readHeader(vaultPath);
  const field = (key: string): unknown => (isMap(header) ? header[key] : undefined);
  const units = field("units");
  const clock = field("clock");
  const weekStart = field("weekStart");
  return {
    units: isUnits(units) ? units : null,
    clock: isClock(clock) ? clock : null,
    weekStart: isWeekStart(weekStart) ? weekStart : null,
  };
}

function checkHours(header: Record<string, unknown>, key: string, problems: string[]): void {
  const value = header[key];
  if (isEmpty(value)) return;
  if (!isMap(value)) {
    problems.push(`${key} must have a from and a to time.`);
    return;
  }
  for (const end of ["from", "to"]) {
    const time = value[end];
    if (!isEmpty(time) && !(typeof time === "string" && timePattern.test(time))) {
      problems.push(`${key}.${end} ${timeProblem}`);
    }
  }
}

/** A list of entries with a date each. A person may have no known birthday; a date entry needs its date. */
function checkDatedList(
  header: Record<string, unknown>,
  key: string,
  dateKey: string,
  required: boolean,
  problems: string[],
): void {
  const value = header[key];
  if (isEmpty(value)) return;
  if (!Array.isArray(value)) {
    problems.push(`${key} must be a list.`);
    return;
  }
  value.forEach((entry: unknown, index) => {
    const date = isMap(entry) ? entry[dateKey] : undefined;
    if (!required && isEmpty(date)) return;
    if (!(typeof date === "string" && isBirthday(date))) {
      problems.push(`${key}[${String(index)}].${dateKey} ${required ? dateProblem : birthdayProblem}`);
    }
  });
}

/** The line that Eva reads before the person's message when the header has problems, or null. */
export function aboutMeProblemNote(problems: readonly string[]): string | null {
  if (problems.length === 0) return null;
  return `[${aboutMeFile} has problems: ${problems.join(" ")} Fix them with the about-me skill.]`;
}

/**
 * The day that Eva started on this vault: the vault's first commit, or the first migration of its
 * record when that is earlier. The record started in October 2026, so for an older vault only the
 * first commit is right. Null when neither is known.
 */
export function installedOn(vaultPath: string, firstCommitDay: string | null): string | null {
  const read = readJsonTolerant(join(vaultPath, ".eva", "migrations.json"));
  if (!read.ok || !isMap(read.value) || !Array.isArray(read.value["applied"])) return firstCommitDay;
  const days = (read.value["applied"] as unknown[])
    .map((entry) => (isMap(entry) && typeof entry["at"] === "string" ? entry["at"].slice(0, 10) : ""))
    .filter(isRealDate);
  return [...days, ...(firstCommitDay === null ? [] : [firstCommitDay])].sort()[0] ?? null;
}

/** The day of the vault's first commit, as `YYYY-MM-DD`, or null when git cannot tell. */
export async function firstCommitDay(
  vaultPath: string,
  runner: ProcessRunner,
  environment: Readonly<Record<string, string>>,
): Promise<string | null> {
  const result = await runner.run(["git", "log", "--max-parents=0", "--format=%cs"], {
    cwd: vaultPath,
    environment: { ...environment, GIT_TERMINAL_PROMPT: "0" },
    timeoutMs: gitTimeoutMs,
  });
  if (result.exitCode !== 0) return null;
  // A vault can have more than one root commit, such as after a merge of two histories.
  return result.stdout.split(/\r?\n/).filter(isRealDate).sort()[0] ?? null;
}

/**
 * The person's home as a point, from `places.home` in the header, or null. Scripts use it when
 * the phone sent no recent location.
 */
export function readHomePlace(vaultPath: string): { readonly lat: number; readonly lon: number } | null {
  const header = readHeader(vaultPath);
  const places = isMap(header) ? header["places"] : undefined;
  const home = isMap(places) ? places["home"] : undefined;
  if (!isMap(home)) return null;
  const [lat, lon] = [coordinate(home["lat"]), coordinate(home["lon"])];
  return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/**
 * A decimal number written as text. An empty field must not read as 0, which is a place at sea.
 * JavaScript writes a very small number with an exponent, such as `1e-7`.
 */
function coordinate(value: unknown): number | null {
  return typeof value === "string" && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(value.trim()) ? Number(value) : null;
}

/** Where a point came from: a live location in Telegram, or the open web app. */
export type LocationSource = "telegram" | "web";

/** The person's last location, as `lastLocation` in the header. Eva's code writes it, never an agent. */
export interface LastLocation {
  readonly latitude: number;
  readonly longitude: number;
  /** The radius of the error, in meters, or null when the phone does not say. */
  readonly accuracy: number | null;
  /** When the phone took the point, as an ISO time. */
  readonly at: string;
  readonly source: LocationSource;
}

export const lastLocationKey = "lastLocation";

const isoTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** The point of `lastLocation` in a note's text, or null when the field is empty or bad. */
export function parseLastLocation(text: string): LastLocation | null {
  const header = headerOf(text);
  const value = isMap(header) ? header[lastLocationKey] : undefined;
  if (!isMap(value)) return null;
  const [latitude, longitude] = [coordinate(value["latitude"]), coordinate(value["longitude"])];
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  // The failsafe schema reads YAML's null as the text "null".
  const noAccuracy = isEmpty(value["accuracy"]) || value["accuracy"] === "null" || value["accuracy"] === "~";
  const accuracy = noAccuracy ? null : coordinate(value["accuracy"]);
  if (!noAccuracy && (accuracy === null || accuracy < 0)) return null;
  const at = value["at"];
  if (typeof at !== "string" || !isoTimePattern.test(at) || Number.isNaN(Date.parse(at))) return null;
  const source = value["source"];
  if (source !== "telegram" && source !== "web") return null;
  return { latitude, longitude, accuracy, at, source };
}

export function readLastLocation(vaultPath: string): LastLocation | null {
  return parseLastLocation(readTextTolerant(join(vaultPath, aboutMeFile)) ?? "");
}

/**
 * The note's text with one top-level field of the header set to `line`, such as `key: value`.
 * Every other byte stays, so the person's own lines and comments survive. A missing field goes
 * at the end of the header, after `comment` when one is given, and a note with no header gets one. Null when the header is broken,
 * or when the new header would not read as the old one with only this field changed.
 */
export function withHeaderField(text: string, key: string, line: string, comment?: string): string | null {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const rest = text.slice(bom.length);
  const before = headerOf(rest);
  if (before === "broken") return null;
  const opening = /^---\r?\n/.exec(rest);
  // The header's own line ending: a body pasted from elsewhere can have another one.
  const newline = (opening?.[0] ?? rest).includes("\r\n") ? "\r\n" : "\n";
  const match = frontMatterPattern.exec(rest);
  const added = comment === undefined ? [line] : [comment, line];
  if (opening === null) return `${bom}---${newline}${added.join(newline)}${newline}---${newline}${rest}`;
  // An empty header has no line between its two `---` lines, so the pattern does not match it.
  const empty = /^---\r?\n---(\r?\n|$)/.test(rest);
  if (match === null && !empty) return null;
  const headerEnd = empty ? opening[0].length : opening[0].length + (match?.[1] ?? "").length;
  const lines = empty ? [] : rest.slice(opening[0].length, headerEnd).split(/\r?\n/);
  const start = lines.findIndex((each) => each === `${key}:` || each.startsWith(`${key}: `));
  if (start === -1) lines.push(...added);
  else {
    // The field's own lines are indented, empty between indented lines, or items of a list.
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
