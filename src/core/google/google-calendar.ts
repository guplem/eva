/**
 * The person's Google Calendar, read by Eva herself with her own Google login, for a widget with
 * an `eva-google-calendar` input (#778). The widget never sees a token: it gets only the plain
 * shapes of the widget contract, never Google's own format.
 *
 * A short cache keeps a grid of widgets from calling Google on each draw.
 */
import { googleAccessToken, type GoogleCheckInputs } from "./google-check.ts";
import { plainDescription } from "./calendar-text.ts";
import { GoogleAnswerCache, googleText as text, isDay, nextDay, previousDay, readGooglePages } from "./google-reads.ts";

export type GoogleCalendarInputs = Omit<GoogleCheckInputs, "readServices">;

/** One calendar that the person shows in Google Calendar. */
export interface WidgetCalendar {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly primary: boolean;
}

interface EventBase {
  readonly id: string;
  readonly calendarId: string;
  readonly title: string;
  readonly place: string | null;
  readonly link: string | null;
  /** The description as plain text, or null. The widget layer finds a project tag in it and cuts it. */
  readonly description: string | null;
}

export interface WidgetTimedEvent extends EventBase {
  readonly startAt: string;
  readonly endAt: string;
}

/** `endDate` is the last day of the event, not the day after it as in Google's format. */
export interface WidgetAllDayEvent extends EventBase {
  readonly date: string;
  readonly endDate: string;
}

export type WidgetCalendarEvent = WidgetTimedEvent | WidgetAllDayEvent;

/** What a widget may read of the calendar. Null means no Google login, or Calendar off. Throws `google_failed`. */
export interface CalendarSource {
  calendars(): Promise<readonly WidgetCalendar[] | null>;
  /** The events of the days `from` to `to`, both included, in the person's calendar time zone. */
  events(from: string, to: string): Promise<readonly WidgetCalendarEvent[] | null>;
}

export interface GoogleCalendarOptions {
  /** Read at each call, so a change in Settings applies at once. */
  readonly inputs: () => GoogleCalendarInputs;
  readonly now: () => Date;
}

/** 2500 is the most that Google gives in one page. The page cap keeps a huge calendar bounded. */
const pageSize = 2500;
const maxPages = 10;
const fallbackColor = "#9e9e9e";

interface CalendarList {
  readonly calendars: readonly WidgetCalendar[];
  /** The time zone of the person's main calendar: the days of a window are in it. */
  readonly timeZone: string;
}

export class GoogleCalendar implements CalendarSource {
  private readonly options: GoogleCalendarOptions;
  private readonly cache: GoogleAnswerCache;

  constructor(options: GoogleCalendarOptions) {
    this.options = options;
    this.cache = new GoogleAnswerCache(options.now);
  }

  async calendars(): Promise<readonly WidgetCalendar[] | null> {
    const list = await this.calendarList();
    return list === null ? null : list.calendars;
  }

  async events(from: string, to: string): Promise<readonly WidgetCalendarEvent[] | null> {
    const inputs = this.options.inputs();
    if (!isCalendarOn(inputs)) return null;
    return this.cache.cached(`events|${inputs.config.email ?? ""}|${from}|${to}`, async () => {
      const list = await this.calendarList();
      if (list === null) return null;
      const access = await googleAccessToken(inputs);
      if ("problem" in access) return null;
      const window = { timeMin: dayStart(from, list.timeZone), timeMax: dayStart(nextDay(to), list.timeZone) };
      const read = await Promise.all(
        list.calendars.map((calendar) => readEvents(inputs, access.accessToken, calendar.id, window, list.timeZone)),
      );
      return sortEvents(read.flat(), list.timeZone);
    });
  }

  private async calendarList(): Promise<CalendarList | null> {
    const inputs = this.options.inputs();
    if (!isCalendarOn(inputs)) return null;
    return this.cache.cached(`calendars|${inputs.config.email ?? ""}`, async () => {
      const access = await googleAccessToken(inputs);
      if ("problem" in access) return null;
      return readCalendarList(inputs, access.accessToken);
    });
  }
}

/** The source of a widget when Eva has no Google: every read answers "no calendar". */
export const noCalendar: CalendarSource = {
  calendars: () => Promise.resolve(null),
  events: () => Promise.resolve(null),
};

function isCalendarOn(inputs: GoogleCalendarInputs): boolean {
  return inputs.config.services.includes("calendar") && inputs.config.email !== null;
}

interface GoogleCalendarEntry {
  readonly id?: unknown;
  readonly summary?: unknown;
  readonly summaryOverride?: unknown;
  readonly backgroundColor?: unknown;
  readonly primary?: unknown;
  readonly selected?: unknown;
  readonly timeZone?: unknown;
}

async function readCalendarList(inputs: GoogleCalendarInputs, accessToken: string): Promise<CalendarList> {
  const entries = await readPages<GoogleCalendarEntry>(
    inputs,
    accessToken,
    "/calendar/v3/users/me/calendarList",
    new URLSearchParams({ maxResults: "250" }),
  );
  // "selected" is the check box of a calendar in Google Calendar: the person shows its events.
  const shown = entries.filter((entry) => typeof entry.id === "string" && entry.selected === true);
  const calendars = shown.map((entry) => ({
    id: entry.id as string,
    name: text(entry.summaryOverride) ?? text(entry.summary) ?? (entry.id as string),
    color: text(entry.backgroundColor) ?? fallbackColor,
    primary: entry.primary === true,
  }));
  const main = entries.find((entry) => entry.primary === true) ?? shown[0];
  const zone = text(main?.timeZone);
  return { calendars, timeZone: zone !== null && isTimeZone(zone) ? zone : "UTC" };
}

interface GoogleEvent {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly eventType?: unknown;
  readonly summary?: unknown;
  readonly location?: unknown;
  readonly htmlLink?: unknown;
  readonly description?: unknown;
  readonly start?: { readonly date?: unknown; readonly dateTime?: unknown };
  readonly end?: { readonly date?: unknown; readonly dateTime?: unknown };
  readonly attendees?: unknown;
}

async function readEvents(
  inputs: GoogleCalendarInputs,
  accessToken: string,
  calendarId: string,
  window: { readonly timeMin: number; readonly timeMax: number },
  timeZone: string,
): Promise<WidgetCalendarEvent[]> {
  const items = await readPages<GoogleEvent>(
    inputs,
    accessToken,
    `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    new URLSearchParams({
      timeMin: new Date(window.timeMin).toISOString(),
      timeMax: new Date(window.timeMax).toISOString(),
      // Each instance of a repeated event, with its own start.
      singleEvents: "true",
      orderBy: "startTime",
      timeZone,
      maxResults: String(pageSize),
    }),
  );
  return items.flatMap((item) => {
    const event = contractEvent(item, calendarId);
    return event === null ? [] : [event];
  });
}

/**
 * The event in the contract's shape, or null for a cancelled or declined event, a working place,
 * or one that Eva cannot read.
 */
function contractEvent(item: GoogleEvent, calendarId: string): WidgetCalendarEvent | null {
  if (typeof item.id !== "string" || item.status === "cancelled" || isDeclined(item.attendees)) return null;
  // Google Calendar shows where the person works each day apart from the events, not as one.
  if (item.eventType === "workingLocation") return null;
  const base = {
    id: item.id,
    calendarId,
    // Google gives no title for an event with none, or for a private event of another person's calendar.
    title: text(item.summary) ?? "",
    place: text(item.location),
    link: text(item.htmlLink),
    // Google keeps the HTML of its editor: the contract gives plain text.
    description: plainDescription(item.description),
  };
  const startAt = text(item.start?.dateTime);
  if (startAt !== null) return { ...base, startAt, endAt: text(item.end?.dateTime) ?? startAt };
  const date = text(item.start?.date);
  if (date === null || !isDay(date)) return null;
  // Google's end day is the day after the event.
  const end = text(item.end?.date);
  const endDate = end !== null && isDay(end) && end > date ? previousDay(end) : date;
  return { ...base, date, endDate };
}

function isDeclined(attendees: unknown): boolean {
  if (!Array.isArray(attendees)) return false;
  return (attendees as unknown[]).some((attendee) => {
    const { self, responseStatus } = (attendee ?? {}) as { self?: unknown; responseStatus?: unknown };
    return self === true && responseStatus === "declined";
  });
}

function sortEvents(events: readonly WidgetCalendarEvent[], timeZone: string): WidgetCalendarEvent[] {
  const start = (event: WidgetCalendarEvent): number =>
    "date" in event ? dayStart(event.date, timeZone) : Date.parse(event.startAt);
  return [...events].sort(
    (first, second) =>
      start(first) - start(second) ||
      // An all-day event comes before a timed event that starts at midnight.
      Number("startAt" in first) - Number("startAt" in second) ||
      first.title.localeCompare(second.title) ||
      first.id.localeCompare(second.id),
  );
}

/** Every item of a list of Google Calendar, page by page. Throws `google_failed`. */
function readPages<Item>(
  inputs: GoogleCalendarInputs,
  accessToken: string,
  path: string,
  query: URLSearchParams,
): Promise<Item[]> {
  return readGooglePages<Item>({ baseUrl: inputs.baseUrl, accessToken, path, query, maxPages, what: "the calendar" });
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The moment that a day starts in a time zone, in milliseconds. */
function dayStart(day: string, timeZone: string): number {
  const local = Date.parse(`${day}T00:00:00Z`);
  // The offset at the first guess can differ from the offset at the real start, on the day the clocks change.
  const first = local - zoneOffsetMs(local, timeZone);
  return local - zoneOffsetMs(first, timeZone);
}

/** How far a time zone's clock is ahead of UTC at a moment. */
function zoneOffsetMs(moment: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(moment));
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((found) => found.type === type)?.value ?? 0);
  const asUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return asUtc - Math.floor(moment / 1000) * 1000;
}
