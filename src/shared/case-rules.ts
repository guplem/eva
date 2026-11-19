/**
 * The rules of a case in `Life/Cases/` (#911): when it is open, its steps, its current step and its
 * deadline. The Cases page of the web app and the cases that Eva gives a widget (#971) both use
 * them, so both show the same case. `fields` holds what the YAML failsafe parser gives: every value
 * is text, a list or a map. A file of an older vault can lack a key, so each value falls back.
 * The days stay as written: each reader words them for the day it runs on.
 */

/** The front matter keys of a case that are not the common keys of a note. */
export type CaseFields = Readonly<Record<string, unknown>>;

/** A text value, or null for an empty or missing one. */
export function textOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
}

export function mapOf(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A date of the front matter: a whole day, a month or a year. */
export interface PartialDay {
  readonly year: number;
  readonly month: number | null;
  readonly day: number | null;
}

export function dayOf(text: string | null): PartialDay | null {
  if (text === null) return null;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = match[2] === undefined ? null : Number(match[2]);
  const day = match[3] === undefined ? null : Number(match[3]);
  if (month !== null && (month < 1 || month > 12)) return null;
  if (month !== null && day !== null) {
    const date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  }
  return { year, month, day };
}

/** A key that sorts by time as text: a month or a year sorts at its start. */
export function sortKey(day: PartialDay): string {
  const pad = (value: number | null): string => String(value ?? 1).padStart(2, "0");
  return `${String(day.year)}-${pad(day.month)}-${pad(day.day)}`;
}

/** The sort key of a day as written, or null when it is no date. */
export function daySortKey(text: string | null): string | null {
  const day = dayOf(text);
  return day === null ? null : sortKey(day);
}

/** One step of a case, with its days as written. */
export interface CaseStepRule {
  readonly text: string;
  readonly doneOn: string | null;
  readonly waitingFor: string | null;
  readonly dueBy: string | null;
  readonly state: "done" | "current" | "todo";
}

/** The steps of a case. The current step is the first step without `done-on`. */
export function caseStepRules(fields: CaseFields): CaseStepRule[] {
  const steps = fields["steps"];
  if (!Array.isArray(steps)) return [];
  let currentFound = false;
  return steps.flatMap((step): CaseStepRule[] => {
    const plain = textOf(step);
    const map = mapOf(step);
    if (plain === null && map === null) return [];
    const doneOn = textOf(map?.["done-on"]);
    const state = doneOn !== null ? "done" : currentFound ? "todo" : "current";
    if (state === "current") currentFound = true;
    return [
      {
        text: plain ?? textOf(map?.["step"]) ?? "A step",
        doneOn,
        waitingFor: textOf(map?.["waiting-for"]),
        dueBy: textOf(map?.["due-by"]),
        state,
      },
    ];
  });
}

export function isClosedCase(fields: CaseFields): boolean {
  // An old vault may have a status key: only a date in `closed` ends a case.
  return textOf(fields["closed"]) !== null;
}

/** The step that a case waits on now, with its due day as written. */
export interface CurrentCaseStep {
  readonly text: string;
  readonly waitingFor: string | null;
  readonly dueBy: string | null;
}

/** The current step of an open case, or null for a closed case or a case with nothing to do. */
export function currentCaseStep(fields: CaseFields): CurrentCaseStep | null {
  if (isClosedCase(fields)) return null;
  if (!Array.isArray(fields["steps"])) {
    // An old-form case keeps its next step in `next`: a text, or a map of `step` and `date`.
    const nextMap = mapOf(fields["next"]);
    const next = nextMap === null ? textOf(fields["next"]) : textOf(nextMap["step"]);
    return next === null
      ? null
      : {
          text: next,
          waitingFor: textOf(nextMap?.["waiting-for"] ?? fields["waiting-for"]),
          dueBy: textOf(nextMap?.["date"] ?? fields["due-by"] ?? fields["due"]),
        };
  }
  const step = caseStepRules(fields).find((each) => each.state === "current");
  return step === undefined ? null : { text: step.text, waitingFor: step.waitingFor, dueBy: step.dueBy };
}

/** The deadline of a case, with its day as written, or null when it has none. */
export function caseDeadline(
  fields: CaseFields,
): { readonly date: string | null; readonly cost: string | null } | null {
  const value = fields["deadline"];
  const map = mapOf(value);
  // An older form writes the day alone.
  const date = textOf(map === null ? value : map["date"]);
  const cost = textOf(map?.["cost"]);
  return date === null && cost === null ? null : { date, cost };
}
