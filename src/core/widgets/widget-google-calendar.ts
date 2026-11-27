/**
 * The contract paths of the Google Calendar (#778, #974). A widget gets them only when its approval
 * holds an `eva-google-calendar` input. Without it, they answer 404, so the widget gets nothing. Only
 * an approval with `write` access writes. Eva logs no event text.
 */
import { z } from "zod";
import { isEvaError } from "../../shared/errors.ts";
import type {
  CalendarRefusal,
  CalendarSource,
  CalendarWrite,
  EventChange,
  EventTime,
  NewEvent,
  WidgetCalendarEvent,
} from "../google/google-calendar.ts";
import { isDay } from "../google/google-reads.ts";
import type { Project } from "../projects/project-catalog.ts";
import { eventsWithProjects } from "./widget-calendar-projects.ts";
import type { WidgetGrant } from "./widget-changes.ts";
import { jsonAnswer, type WidgetAnswer } from "./widget-data.ts";

const calendarsPath = "eva/google-calendar/calendars.json";
const eventsPath = "eva/google-calendar/events.json";
/** Google's event ids use only these characters. The pattern keeps a `/`, a `..` or a `?` out of Google's address. */
const eventPathPattern = /^eva\/google-calendar\/events\/([A-Za-z0-9_-]{1,1024})\.json$/;
const eventsFolder = "eva/google-calendar/events/";

/** The longest window of `events.json`, in days, both ends included. */
export const maxCalendarDays = 62;
/** The largest body of a calendar write. An event is small: the cap is the one of `eva/state.json`. */
export const maxEventWriteBytes = 64 * 1024;
/** The most guests of one event. */
const maxGuests = 100;
/** One address, with no list, no name and no angle brackets. Google checks the rest. */
const emailPattern = /^[^\s@,;:<>()[\]"\\]+@[^\s@,;:<>()[\]"\\]+\.[^\s@,;:<>()[\]"\\]+$/;
/** A time in RFC 3339, as Google wants it: seconds and an offset, so it names one moment. */
const momentPattern = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Unknown keys, such as `id`, `link` and `project` of a read, are dropped. */
const eventBodySchema = z.object({
  calendarId: z.string().min(1).max(1024),
  title: z.string().max(1024).optional(),
  place: z.string().max(1024).nullable().optional(),
  description: z.string().max(8192).nullable().optional(),
  guests: z.array(z.string().max(254).regex(emailPattern)).max(maxGuests).optional(),
  startAt: z.string().regex(momentPattern).optional(),
  endAt: z.string().regex(momentPattern).optional(),
  date: z.string().optional(),
  endDate: z.string().optional(),
  sendInvitations: z.boolean().optional(),
});

export interface CalendarWriteRequest {
  readonly path: string;
  readonly method: string;
  readonly query: URLSearchParams;
  readonly body: Uint8Array | null;
  readonly access: WidgetGrant["googleCalendar"];
  readonly source: CalendarSource;
  /** The projects, read only when the written event names one with its tag (#1012). */
  readonly projects: () => readonly Project[];
}

/**
 * The answer to a write of the calendar, or null for a read or a path that is not a write path of
 * the calendar. The caller answers those as before.
 */
export async function calendarWriteAnswer(request: CalendarWriteRequest): Promise<WidgetAnswer | null> {
  const { path, method } = request;
  if (method === "GET" || method === "HEAD") return null;
  const eventId = eventPathPattern.exec(path)?.[1] ?? null;
  const inEvents = path.startsWith(eventsFolder);
  if (path !== eventsPath && !inEvents) return null;
  if (request.access === null) return { status: 404 };
  // A read approval never writes, whatever the request holds.
  if (request.access !== "write") return { status: 405 };
  // An id that is not one of Google's never reaches Google's address.
  if (inEvents && eventId === null) return { status: 404 };
  const allowed = eventId === null ? method === "POST" : method === "PUT" || method === "DELETE";
  if (!allowed) return { status: 405 };
  try {
    if (eventId !== null && method === "DELETE") {
      const calendarId = request.query.get("calendarId") ?? "";
      const sendInvitations = queryChoice(request.query.get("sendInvitations"));
      if (calendarId === "" || calendarId.length > 1024 || sendInvitations === null) return { status: 400 };
      return writeAnswer(await request.source.remove(calendarId, eventId, sendInvitations), 204, request.projects);
    }
    const parsed = parseEvent(request.body, { create: eventId === null });
    if ("status" in parsed) return parsed;
    const { event, sendInvitations } = parsed;
    if (eventId === null) {
      // `parseEvent` refuses a new event with no time.
      const time = event.time;
      if (time === undefined) return { status: 400 };
      return writeAnswer(await request.source.create({ ...event, time }, sendInvitations), 201, request.projects);
    }
    return writeAnswer(await request.source.change(eventId, event, sendInvitations), 200, request.projects);
  } catch (error) {
    // Google failed: the widget shows that the calendar is not available now, and tries again later.
    if (isEvaError(error, "google_failed")) return { status: 502 };
    throw error;
  }
}

/** Only the exact text `true` sends invitations. A missing choice sends none. */
function queryChoice(value: string | null): boolean | null {
  if (value === null || value === "false") return false;
  return value === "true" ? true : null;
}

function parseEvent(
  body: Uint8Array | null,
  options: { readonly create: boolean },
): { readonly event: EventChange & Pick<NewEvent, "guests">; readonly sendInvitations: boolean } | WidgetAnswer {
  if (body === null) return { status: 400 };
  if (body.byteLength > maxEventWriteBytes) return { status: 413 };
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return { status: 400 };
  }
  const parsed = eventBodySchema.safeParse(value);
  if (!parsed.success) return { status: 400 };
  const { startAt, endAt, date, endDate, sendInvitations, ...fields } = parsed.data;
  const time = eventTime({ startAt, endAt, date, endDate });
  if (time === "invalid" || (options.create && time === null)) return { status: 400 };
  // The reads give no guests, so a change of the guest list would drop the guests that the widget never saw.
  if (!options.create && fields.guests !== undefined) return { status: 400 };
  const event: EventChange & Pick<NewEvent, "guests"> = {
    calendarId: fields.calendarId,
    ...(fields.title === undefined ? {} : { title: fields.title }),
    ...(fields.place === undefined ? {} : { place: fields.place }),
    ...(fields.description === undefined ? {} : { description: fields.description }),
    ...(fields.guests === undefined ? {} : { guests: fields.guests }),
    ...(time === null ? {} : { time }),
  };
  return { event, sendInvitations: sendInvitations === true };
}

/** The time of a body: both timed fields, both all-day fields, or none. */
function eventTime(fields: {
  readonly startAt: string | undefined;
  readonly endAt: string | undefined;
  readonly date: string | undefined;
  readonly endDate: string | undefined;
}): EventTime | null | "invalid" {
  const { startAt, endAt, date, endDate } = fields;
  const timed = startAt !== undefined || endAt !== undefined;
  const allDay = date !== undefined || endDate !== undefined;
  if (timed && allDay) return "invalid";
  if (timed) {
    if (startAt === undefined || endAt === undefined) return "invalid";
    // The pattern checks the form. The day must also exist: Date.parse moves 30 February to March.
    if (!isDay(startAt.slice(0, 10)) || !isDay(endAt.slice(0, 10))) return "invalid";
    const start = Date.parse(startAt);
    const end = Date.parse(endAt);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? { startAt, endAt } : "invalid";
  }
  if (!allDay) return null;
  if (date === undefined || endDate === undefined || !isDay(date) || !isDay(endDate) || endDate < date)
    return "invalid";
  return { date, endDate };
}

function writeAnswer(
  result: CalendarWrite<WidgetCalendarEvent | null>,
  status: number,
  projects: () => readonly Project[],
): WidgetAnswer {
  if ("refused" in result) return refusalAnswer(result.refused);
  if (status === 204) return { status };
  const event = result.done === null ? null : (eventsWithProjects([result.done], projects)[0] ?? null);
  return { ...jsonAnswer(event), status };
}

/** A refusal that the widget explains carries its reason. These reasons are names of the contract. */
function refusalAnswer(refused: CalendarRefusal): WidgetAnswer {
  if (refused === "notFound") return { status: 404 };
  if (refused === "invalid") return { status: 400 };
  return { ...jsonAnswer({ reason: refused }), status: 403 };
}

/** The answer to a calendar read, or null when the path is not one of them. A write reaches `calendarWriteAnswer`. */
export async function calendarAnswer(
  path: string,
  query: URLSearchParams,
  access: WidgetGrant["googleCalendar"],
  source: CalendarSource,
  /** The projects, read only when an event names one with its tag (#1012). */
  projects: () => readonly Project[],
): Promise<WidgetAnswer | null> {
  if (path !== calendarsPath && path !== eventsPath) return null;
  if (access === null) return { status: 404 };
  try {
    if (path === calendarsPath) return jsonAnswer(await source.calendars());
    const from = query.get("from") ?? "";
    const to = query.get("to") ?? "";
    if (!isWindow(from, to)) return { status: 400 };
    const events = await source.events(from, to);
    return jsonAnswer(events === null ? null : eventsWithProjects(events, projects));
  } catch (error) {
    // Google failed or refused: the widget shows that the calendar is not there now, and tries again later.
    if (isEvaError(error, "google_failed")) return { status: 502 };
    throw error;
  }
}

/** True for a window of real days, `to` not before `from`, of at most `maxCalendarDays` days. */
export function isWindow(from: string, to: string): boolean {
  if (!isDay(from) || !isDay(to) || to < from) return false;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs + 1;
  return days <= maxCalendarDays;
}

const dayMs = 86_400_000;
