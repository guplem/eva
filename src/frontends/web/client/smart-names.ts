/**
 * The smart names of the Files page (issue 429). A technical name gives way to the name that a
 * person reads: a project folder shows its title, and a date at the start of a name moves to a pill.
 */
import { months } from "./chat-list.ts";
import { fileBadgeOf } from "./file-kinds.ts";

export interface SmartName {
  readonly name: string;
  /** The words of the date at the start of the real name, such as "2 Mar 2026, 10:15", or null. */
  readonly date: string | null;
}

export interface SmartNameOptions {
  /** The project title that the core sends for a project folder. */
  readonly title?: string | undefined;
  /** True where a type badge shows the extension, so the name can drop it. */
  readonly badge?: boolean;
}

/**
 * The forms of a project id, the longest first: `YYYY-MM-DD-HHmm`, `YYYY-MM-DD`, `YYYY-MM` and
 * `YYYY`. A space, a `_` or a `-` ends the date. A date that cannot exist tries the next form.
 */
const datePatterns = [
  /^(\d{4})-(\d{2})-(\d{2})[-_ ](\d{2})(\d{2})[-_ ]+(.+)$/,
  /^(\d{4})-(\d{2})-(\d{2})[-_ ]+(.+)$/,
  /^(\d{4})-(\d{2})[-_ ]+(.+)$/,
  /^(\d{4})[-_ ]+(.+)$/,
];

/** A rest with no letter, as in `2026-03-02`, is part of the date, not a name. */
const letter = /\p{L}/u;

export function smartName(real: string, options: SmartNameOptions): SmartName {
  // A dot at the start, as in ".env", is no extension: the name would be empty.
  const dot = real.lastIndexOf(".");
  const base = options.badge === true && dot > 0 && fileBadgeOf(real) !== null ? real.slice(0, dot) : real;
  const dated = splitDate(base);
  const title = options.title?.trim() ?? "";
  if (title !== "") return { name: title, date: dated?.date ?? null };
  return dated ?? { name: base, date: null };
}

function splitDate(name: string): SmartName | null {
  for (const pattern of datePatterns) {
    const match = pattern.exec(name);
    if (match === null) continue;
    const parts = match.slice(1, -1).map(Number);
    const rest = match[match.length - 1] ?? "";
    const date = dateWords(parts);
    if (date !== null && letter.test(rest)) return { name: rest, date };
  }
  return null;
}

/** "2026", "Mar 2026", "2 Mar 2026" or "2 Mar 2026, 10:15", or null for a date that cannot exist. */
function dateWords([year = 0, month, day, hour, minute]: readonly number[]): string | null {
  if (year < 1900 || year > 2199) return null;
  if (month === undefined) return String(year);
  if (month < 1 || month > 12) return null;
  const monthYear = `${months[month - 1] ?? ""} ${String(year)}`;
  if (day === undefined) return monthYear;
  // Day 0 of the next month is the last day of this one.
  if (day < 1 || day > new Date(year, month, 0).getDate()) return null;
  const date = `${String(day)} ${monthYear}`;
  if (hour === undefined || minute === undefined) return date;
  if (hour > 23 || minute > 59) return null;
  return `${date}, ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
