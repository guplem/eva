/**
 * The contract path of the open cases that contract 2 adds (#966, #971). A widget gets it only when
 * its approval holds the input. Without it, the path answers 404, so the widget gets nothing. The
 * Google Calendar paths have their own file, `widget-google-calendar.ts`.
 */
import { openCases } from "./widget-cases.ts";
import type { WidgetGrant } from "./widget-changes.ts";
import { jsonAnswer, type WidgetAnswer } from "./widget-data.ts";

const casesPath = "eva/cases.json";

/** Where Eva's data comes from. */
export interface EvaDataSources {
  readonly vaultPath: string;
}

/** The answer to a path of Eva's data, or null when the path is not one of them. */
export function evaDataAnswer(
  path: string,
  grant: Pick<WidgetGrant, "cases">,
  sources: EvaDataSources,
): WidgetAnswer | null {
  if (path === casesPath) return grant.cases ? jsonAnswer(openCases(sources.vaultPath)) : { status: 404 };
  return null;
}
