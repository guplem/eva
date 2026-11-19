/**
 * The contract paths of the Google Calendar (#778). A widget gets them only when its approval holds
 * an `eva-google-calendar` input. Without it, they answer 404, so the widget gets nothing.
 */
import { isEvaError } from "../../shared/errors.ts";
import { isDay, type CalendarSource } from "../google/google-calendar.ts";
import type { WidgetGrant } from "./widget-changes.ts";
import { jsonAnswer, type WidgetAnswer } from "./widget-data.ts";

const calendarsPath = "eva/google-calendar/calendars.json";
const eventsPath = "eva/google-calendar/events.json";

/** The longest window of `events.json`, in days, both ends included. */
export const maxCalendarDays = 62;

/**
 * The answer to a calendar path, or null when the path is not one of them. Only a read reaches
 * here: Eva serves no write of the calendar yet.
 */
export async function calendarAnswer(
  path: string,
  query: URLSearchParams,
  access: WidgetGrant["googleCalendar"],
  source: CalendarSource,
): Promise<WidgetAnswer | null> {
  if (path !== calendarsPath && path !== eventsPath) return null;
  if (access === null) return { status: 404 };
  try {
    if (path === calendarsPath) return jsonAnswer(await source.calendars());
    const from = query.get("from") ?? "";
    const to = query.get("to") ?? "";
    if (!isWindow(from, to)) return { status: 400 };
    return jsonAnswer(await source.events(from, to));
  } catch (error) {
    // Google failed or refused: the widget shows that the calendar is not there now, and tries again later.
    if (isEvaError(error, "google_failed")) return { status: 502 };
    throw error;
  }
}

function isWindow(from: string, to: string): boolean {
  if (!isDay(from) || !isDay(to) || to < from) return false;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs + 1;
  return days <= maxCalendarDays;
}

const dayMs = 86_400_000;
