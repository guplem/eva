/**
 * The person's basic facts, from the YAML header of `Life/About me.md`. Eva fills the header with
 * the vault's `about-me` skill, and code reads it here: the festive eyes, a greeting by name, and
 * later scripts such as a weather forecast. A bad field never breaks Eva: the reader ignores it and
 * names it, so Eva can fix it in her next turn.
 */
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { readJsonTolerant, readTextTolerant } from "../../shared/files.ts";
import { frontMatterPattern } from "../projects/project-catalog.ts";
import type { ProcessRunner } from "../../shared/process-runner.ts";

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
  "region",
  "hemisphere",
  "units",
  "clock",
  "weekStart",
  "sleep",
  "work",
  "places",
  "people",
  "dates",
  "diet",
  "allergies",
] as const;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const regionPattern = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;
const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

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
  const text = readTextTolerant(join(vaultPath, aboutMeFile));
  // A Windows editor can put a byte order mark before the header.
  const match = frontMatterPattern.exec((text ?? "").replace(/^\uFEFF/, ""));
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
  text1("clock", (value) => value === "12h" || value === "24h", "must be 12h or 24h.");
  text1("units", (value) => value === "metric" || value === "imperial", "must be metric or imperial.");
  text1("weekStart", (value) => days.includes(value), "must be a day, such as monday.");
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

/** A decimal number written as text. An empty field must not read as 0, which is a place at sea. */
function coordinate(value: unknown): number | null {
  return typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : null;
}
