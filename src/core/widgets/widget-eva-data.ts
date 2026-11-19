/**
 * The contract path of the open cases that contract 2 adds (#966). A widget gets it only when its
 * approval holds the input. Without it, the path answers 404, so the widget gets nothing. Eva serves
 * no data yet: the approved path answers null, as "no data", until the issue that serves the data
 * fills it. The Google Calendar paths have their own file, `widget-google-calendar.ts`.
 */
import type { WidgetGrant } from "./widget-changes.ts";
import { jsonAnswer, type WidgetAnswer } from "./widget-data.ts";

const casesPath = "eva/cases.json";

/** The answer to a path of Eva's data, or null when the path is not one of them. */
export function evaDataAnswer(path: string, grant: Pick<WidgetGrant, "cases">): WidgetAnswer | null {
  if (path === casesPath) return grant.cases ? jsonAnswer(null) : { status: 404 };
  return null;
}
