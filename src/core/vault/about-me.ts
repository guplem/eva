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

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const regionPattern = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;
const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const dateProblem = "must be a date as YYYY-MM-DD.";
const timeProblem = "must be a time as HH:mm.";

function isRealDate(text: string): boolean {
  if (!datePattern.test(text)) return false;
  const date = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the header and checks each field that the `about-me` skill describes. */
export function readAboutMe(vaultPath: string): AboutMe {
  const empty: AboutMe = { name: null, birthDate: null, region: null, hemisphere: null, problems: [] };
  const text = readTextTolerant(join(vaultPath, aboutMeFile));
  const match = frontMatterPattern.exec(text ?? "");
  if (match === null) return empty;
  let header: unknown;
  try {
    // The failsafe schema keeps every value as text, so a date stays exactly as the person wrote it.
    header = parseYaml(match[1] ?? "", { schema: "failsafe" });
  } catch {
    return { ...empty, problems: [`The header of ${aboutMeFile} is not valid YAML.`] };
  }
  if (!isMap(header)) return empty;

  const problems: string[] = [];
  const text1 = (key: string, valid: (value: string) => boolean, problem: string): string | null => {
    const value = header[key];
    if (isEmpty(value)) return null;
    if (typeof value === "string" && valid(value)) return value;
    problems.push(`${key} ${problem}`);
    return null;
  };

  const name = text1("name", (value) => value.trim() !== "", "must be a text.");
  const birthDate = text1("birthDate", isRealDate, dateProblem);
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
  checkDatedList(header, "people", "birthDate", problems);
  checkDatedList(header, "dates", "date", problems);
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

function checkDatedList(header: Record<string, unknown>, key: string, dateKey: string, problems: string[]): void {
  const value = header[key];
  if (isEmpty(value)) return;
  if (!Array.isArray(value)) {
    problems.push(`${key} must be a list.`);
    return;
  }
  value.forEach((entry: unknown, index) => {
    const date = isMap(entry) ? entry[dateKey] : undefined;
    if (!(typeof date === "string" && isRealDate(date)))
      problems.push(`${key}[${String(index)}].${dateKey} ${dateProblem}`);
  });
}

/** The line that Eva reads before the person's message when the header has problems, or null. */
export function aboutMeProblemNote(problems: readonly string[]): string | null {
  if (problems.length === 0) return null;
  return `[${aboutMeFile} has problems: ${problems.join(" ")} Fix them with the about-me skill.]`;
}

/**
 * The day that Eva started on this vault: the first migration of the vault's record, which a new
 * vault gets at once. Null when the vault has no readable record.
 */
export function installedOn(vaultPath: string): string | null {
  const read = readJsonTolerant(join(vaultPath, ".eva", "migrations.json"));
  if (!read.ok || !isMap(read.value) || !Array.isArray(read.value["applied"])) return null;
  const days = (read.value["applied"] as unknown[])
    .map((entry) => (isMap(entry) && typeof entry["at"] === "string" ? entry["at"].slice(0, 10) : ""))
    .filter(isRealDate)
    .sort();
  return days[0] ?? null;
}
