/**
 * The contract paths of Eva's own data that contract 2 adds (#966): the Google Calendar (#778) and
 * the open cases (#971). A widget gets a path only when its approval holds the input. Without it,
 * the path answers 404, so the widget gets nothing. An approved calendar path answers null, as
 * "no data", until the issue that serves the calendar fills it.
 */
import { openCases } from "./widget-cases.ts";
import type { WidgetGrant } from "./widget-changes.ts";
import { jsonAnswer, type WidgetAnswer } from "./widget-data.ts";

const calendarPaths: ReadonlySet<string> = new Set([
  "eva/google-calendar/calendars.json",
  "eva/google-calendar/events.json",
]);

const casesPath = "eva/cases.json";

/** Where Eva's data comes from. */
export interface EvaDataSources {
  readonly vaultPath: string;
}

/** The answer to a path of Eva's data, or null when the path is not one of them. */
export function evaDataAnswer(
  path: string,
  grant: Pick<WidgetGrant, "googleCalendar" | "cases">,
  sources: EvaDataSources,
): WidgetAnswer | null {
  if (calendarPaths.has(path)) return grant.googleCalendar === null ? { status: 404 } : jsonAnswer(null);
  if (path === casesPath) return grant.cases ? jsonAnswer(openCases(sources.vaultPath)) : { status: 404 };
  return null;
}
