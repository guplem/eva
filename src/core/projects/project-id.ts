/**
 * A project id is the name of its folder: the creation time and a slug,
 * `YYYY-MM-DD-HHmm-name`. An old project known only to the day,
 * month or year has a shorter time part.
 */
import { EvaError } from "../../shared/errors.ts";

export type ProjectIdPrecision = "minute" | "day" | "month" | "year";

export interface ProjectCreationTime {
  readonly year: number;
  readonly month?: number;
  readonly day?: number;
  readonly hour?: number;
  readonly minute?: number;
}

export interface ParsedProjectId {
  readonly id: string;
  readonly created: ProjectCreationTime;
  readonly precision: ProjectIdPrecision;
  readonly slug: string;
}

const slugPattern = "[a-z0-9]+(?:-[a-z0-9]+)*";
const projectIdPattern = new RegExp(`^(\\d{4})(?:-(\\d{2})(?:-(\\d{2})(?:-(\\d{2})(\\d{2}))?)?)?-(${slugPattern})$`);

/** Reads a project folder name, or returns null when the name is not a project id. */
export function parseProjectId(folderName: string): ParsedProjectId | null {
  const match = projectIdPattern.exec(folderName);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, slug] = match;
  if (yearText === undefined || slug === undefined) return null;

  const created: { year: number; month?: number; day?: number; hour?: number; minute?: number } = {
    year: Number(yearText),
  };
  if (monthText !== undefined) created.month = Number(monthText);
  if (dayText !== undefined) created.day = Number(dayText);
  if (hourText !== undefined && minuteText !== undefined) {
    created.hour = Number(hourText);
    created.minute = Number(minuteText);
  }
  if (!isValidCreationTime(created)) return null;

  return { id: folderName, created, precision: precisionOf(created), slug };
}

/**
 * Builds the id of a new project from its `created` value and a free-text name. The id keeps only
 * the wall clock digits of the configured time zone, not the offset (lesson 68).
 */
export function formatProjectId(created: string, name: string): string {
  const slug = projectSlug(name);
  if (slug.length === 0)
    throw new EvaError(
      "project_invalid",
      `A project name needs at least one letter from a to z or one digit: "${name}"`,
    );
  return `${created.slice(0, "YYYY-MM-DDTHH:mm".length).replace("T", "-").replace(":", "")}-${slug}`;
}

/**
 * The `created` value of a new project: the wall clock of the time zone, with that zone's UTC offset
 * at this moment, such as `2026-01-31T09:15+01:00`. With the offset, a reader converts the moment
 * exactly to another zone. Code writes it, so no agent gets a summer time offset wrong.
 */
export function projectCreatedAt(moment: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "00";
  const [year, month, day, hour, minute] = [part("year"), part("month"), part("day"), part("hour"), part("minute")];
  // Each offset is a whole number of minutes, so the wall clock minus the moment, both to the minute, is the offset.
  const wallMinutes = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) / 60_000;
  const offset = wallMinutes - Math.floor(moment.getTime() / 60_000);
  const size = Math.abs(offset);
  const sign = offset < 0 ? "-" : "+";
  const offsetText = `${sign}${String(Math.floor(size / 60)).padStart(2, "0")}:${String(size % 60).padStart(2, "0")}`;
  return `${year}-${month}-${day}T${hour}:${minute}${offsetText}`;
}

/**
 * The name of a new project's folder and repository. A long slug breaks paths on Windows and
 * GitHub's 100-character limit, so the slug ends at a hyphen before 60 characters.
 */
const slugLimit = 60;

/** The name part of a project id: lowercase letters and digits, joined by hyphens. */
export function projectSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= slugLimit) return slug;
  const lastHyphen = slug.slice(0, slugLimit + 1).lastIndexOf("-");
  return slug.slice(0, lastHyphen > 0 ? lastHyphen : slugLimit);
}

function isValidCreationTime(time: ProjectCreationTime): boolean {
  if (time.month !== undefined && (time.month < 1 || time.month > 12)) return false;
  if (time.day !== undefined && (time.day < 1 || time.day > 31)) return false;
  if (time.hour !== undefined && time.hour > 23) return false;
  if (time.minute !== undefined && time.minute > 59) return false;
  return true;
}

function precisionOf(time: ProjectCreationTime): ProjectIdPrecision {
  if (time.minute !== undefined) return "minute";
  if (time.day !== undefined) return "day";
  if (time.month !== undefined) return "month";
  return "year";
}
