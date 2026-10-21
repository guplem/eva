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
 * Builds the id of a new project from its creation time and a free-text name. The time is the
 * wall clock of the configured time zone, `YYYY-MM-DDTHH:mm`, the form of `created` (lesson 68).
 */
export function formatProjectId(wallClock: string, name: string): string {
  const slug = projectSlug(name);
  if (slug.length === 0)
    throw new EvaError("project_invalid", `A project name needs at least one letter or digit: "${name}"`);
  return `${wallClock.replace("T", "-").replace(":", "")}-${slug}`;
}

/** The name part of a project id: lowercase letters and digits, joined by hyphens. */
export function projectSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
