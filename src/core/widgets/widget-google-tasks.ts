/**
 * The contract paths of Google Tasks (#1102). A widget gets them only when its approval holds an
 * `eva-google-tasks` input. Without it, they answer 404, so the widget gets nothing.
 */
import { isEvaError } from "../../shared/errors.ts";
import type { TasksSource } from "../google/google-tasks.ts";
import type { WidgetGrant } from "./widget-changes.ts";
import { jsonAnswer, type WidgetAnswer } from "./widget-data.ts";
import { isWindow } from "./widget-google-calendar.ts";

const listsPath = "eva/google-tasks/lists.json";
const tasksPath = "eva/google-tasks/tasks.json";

/**
 * The answer to a tasks path, or null when the path is not one of them. Only a read reaches here:
 * Eva serves no write of the tasks yet.
 */
export async function tasksAnswer(
  path: string,
  query: URLSearchParams,
  access: WidgetGrant["googleTasks"],
  source: TasksSource,
): Promise<WidgetAnswer | null> {
  if (path !== listsPath && path !== tasksPath) return null;
  if (access === null) return { status: 404 };
  try {
    if (path === listsPath) return jsonAnswer(await source.lists());
    const from = query.get("from") ?? "";
    const to = query.get("to") ?? "";
    // The same window as the calendar's events, so a widget asks for both with one window.
    if (!isWindow(from, to)) return { status: 400 };
    return jsonAnswer(await source.tasks(from, to));
  } catch (error) {
    // Google failed or refused: the widget shows that the tasks are not there now, and tries again later.
    if (isEvaError(error, "google_failed")) return { status: 502 };
    throw error;
  }
}
