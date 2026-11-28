/**
 * The person's Google Calendar, read and written by Eva herself with her own Google login, for a
 * widget with an `eva-google-calendar` input (#778, #974). The widget never sees a token: it gets
 * only the plain shapes of the widget contract, never Google's own format.
 *
 * A short cache keeps a grid of widgets from calling Google on each draw. A write clears it.
 */
import { EvaError } from "../../shared/errors.ts";
import { googleAccessToken, type GoogleCheckInputs } from "./google-check.ts";
import { plainDescription } from "./calendar-text.ts";
import { googleUrls } from "./google-login.ts";
import { GoogleAnswerCache, googleText as text, isDay, nextDay, previousDay, readGooglePages } from "./google-reads.ts";

export type GoogleCalendarInputs = Omit<GoogleCheckInputs, "readServices">;

/** One calendar that the person shows in Google Calendar. */
export interface WidgetCalendar {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly primary: boolean;
  /** True when the person owns the calendar or may change its events. */
  readonly writable: boolean;
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

/** The time of an event to write. `endDate` is the last day, as in the reads. */
export type EventTime =
  { readonly startAt: string; readonly endAt: string } | { readonly date: string; readonly endDate: string };

/** A change of an event: only the given fields change. Null clears a text. */
export interface EventChange {
  readonly calendarId: string;
  readonly title?: string;
  readonly place?: string | null;
  readonly description?: string | null;
  readonly time?: EventTime;
}

/**
 * A change never takes guests: the reads give no guests, so a change would drop the guests that the
 * widget never saw.
 */
export interface NewEvent extends EventChange {
  readonly time: EventTime;
  /** The emails of the guests. */
  readonly guests?: readonly string[];
}

/**
 * Why Eva did not write. These are sent names of the widget contract, except `notFound` and
 * `invalid`, which the widget sees only as a status.
 */
export type CalendarRefusal = "calendarOff" | "readOnly" | "logIn" | "notAllowed" | "notFound" | "invalid";

export type CalendarWrite<Done> = { readonly done: Done } | { readonly refused: CalendarRefusal };

/**
 * What a widget may read and write of the calendar. A read gives null for no Google login, or
 * Calendar off. Each call throws `google_failed` when Google fails.
 */
export interface CalendarSource {
  calendars(): Promise<readonly WidgetCalendar[] | null>;
  /** The events of the days `from` to `to`, both included, in the person's calendar time zone. */
  events(from: string, to: string): Promise<readonly WidgetCalendarEvent[] | null>;
  /** `sendInvitations` false sends no email to a guest. The new event is null when Eva cannot read Google's answer. */
  create(event: NewEvent, sendInvitations: boolean): Promise<CalendarWrite<WidgetCalendarEvent | null>>;
  change(id: string, change: EventChange, sendInvitations: boolean): Promise<CalendarWrite<WidgetCalendarEvent | null>>;
  remove(calendarId: string, id: string, sendInvitations: boolean): Promise<CalendarWrite<null>>;
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

  create(event: NewEvent, sendInvitations: boolean): Promise<CalendarWrite<WidgetCalendarEvent | null>> {
    return this.write({ calendarId: event.calendarId, method: "POST", id: null, sendInvitations }, googleEvent(event));
  }

  change(
    id: string,
    change: EventChange,
    sendInvitations: boolean,
  ): Promise<CalendarWrite<WidgetCalendarEvent | null>> {
    return this.write(
      { calendarId: change.calendarId, method: "PATCH", id, sendInvitations },
      googleEvent(change, { patch: true }),
    );
  }

  async remove(calendarId: string, id: string, sendInvitations: boolean): Promise<CalendarWrite<null>> {
    const result = await this.write({ calendarId, method: "DELETE", id, sendInvitations }, null);
    return "refused" in result ? result : { done: null };
  }

  /** `accessToken` is a token that the caller already has, so a write refreshes the token only once. */
  private async calendarList(accessToken?: string): Promise<CalendarList | null> {
    const inputs = this.options.inputs();
    if (!isCalendarOn(inputs)) return null;
    return this.cache.cached(`calendars|${inputs.config.email ?? ""}`, async () => {
      if (accessToken !== undefined) return readCalendarList(inputs, accessToken);
      const access = await googleAccessToken(inputs);
      if ("problem" in access) return null;
      return readCalendarList(inputs, access.accessToken);
    });
  }

  private async write(
    target: {
      readonly calendarId: string;
      readonly method: "POST" | "PATCH" | "DELETE";
      readonly id: string | null;
      readonly sendInvitations: boolean;
    },
    body: Readonly<Record<string, unknown>> | null,
  ): Promise<CalendarWrite<WidgetCalendarEvent | null>> {
    const inputs = this.options.inputs();
    if (!isCalendarOn(inputs)) return { refused: "calendarOff" };
    // A lower level gives no scope that can write to the calendar, as for a Drive folder.
    if (inputs.config.access.calendar !== "full") return { refused: "readOnly" };
    // The same check as the reads. After a change of level, the old login lacks the new scopes.
    const access = await googleAccessToken(inputs);
    if ("problem" in access) return { refused: "logIn" };
    const list = await this.calendarList(access.accessToken);
    if (list === null) return { refused: "logIn" };
    // Only a calendar that the person shows, as in the reads: a widget never writes to a hidden one.
    if (!list.calendars.some((calendar) => calendar.id === target.calendarId)) return { refused: "notFound" };
    const event = target.id === null ? "" : `/${encodeURIComponent(target.id)}`;
    // Eva always names the choice, so a guest never gets an email that the widget did not ask for.
    const query = new URLSearchParams({ sendUpdates: target.sendInvitations ? "all" : "none" });
    try {
      const answer = await sendEvent({
        baseUrl: inputs.baseUrl,
        accessToken: access.accessToken,
        method: target.method,
        address: `/calendar/v3/calendars/${encodeURIComponent(target.calendarId)}/events${event}?${query.toString()}`,
        body,
      });
      if ("refused" in answer) return answer;
      return { done: answer.item === null ? null : contractEvent(answer.item, target.calendarId) };
    } finally {
      // Even a failed write can have reached Google.
      this.cache.clear();
    }
  }
}

/** The source of a widget when Eva has no Google: every read answers "no calendar", and every write refuses. */
export const noCalendar: CalendarSource = {
  calendars: () => Promise.resolve(null),
  events: () => Promise.resolve(null),
  create: () => Promise.resolve({ refused: "calendarOff" }),
  change: () => Promise.resolve({ refused: "calendarOff" }),
  remove: () => Promise.resolve({ refused: "calendarOff" }),
};

/** Google's fields of an event. A patch sends only the given fields. */
function googleEvent(
  change: EventChange & Pick<NewEvent, "guests">,
  options: { readonly patch: boolean } = { patch: false },
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (change.title !== undefined) body["summary"] = change.title;
  // An empty text clears a field in Google, and the reads give it as null.
  if (change.place !== undefined) body["location"] = change.place ?? "";
  if (change.description !== undefined) body["description"] = change.description ?? "";
  // Google refuses or merges a guest twice: Eva sends each address once, whatever its case.
  if (change.guests !== undefined) {
    const seen = new Set<string>();
    body["attendees"] = change.guests
      .filter((email) => !seen.has(email.toLowerCase()) && Boolean(seen.add(email.toLowerCase())))
      .map((email) => ({ email }));
  }
  const time = change.time;
  if (time !== undefined) {
    const timed = "startAt" in time;
    // Google's end day is the day after the event.
    const start = timed ? { dateTime: time.startAt } : { date: time.date };
    const end = timed ? { dateTime: time.endAt } : { date: nextDay(time.endDate) };
    // A patch merges `start` and `end`: the other form of time must go, or Google keeps both.
    const other = timed ? { date: null } : { dateTime: null };
    body["start"] = options.patch ? { ...start, ...other } : start;
    body["end"] = options.patch ? { ...end, ...other } : end;
  }
  return body;
}

const writeTimeoutMs = 30_000;
/** Google's reasons for a 403 that is a short limit, not a refusal: the widget tries again later. */
const limitReasons = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"]);

/** Sends one write to Google Calendar. Throws `google_failed` with only the status, never Google's text. */
async function sendEvent(request: {
  readonly baseUrl: string | undefined;
  readonly accessToken: string;
  readonly method: string;
  readonly address: string;
  readonly body: Readonly<Record<string, unknown>> | null;
}): Promise<{ readonly item: GoogleEvent | null } | { readonly refused: CalendarRefusal }> {
  let response: Response;
  try {
    response = await fetch(`${googleUrls(request.baseUrl).api}${request.address}`, {
      method: request.method,
      headers: {
        authorization: `Bearer ${request.accessToken}`,
        ...(request.body === null ? {} : { "content-type": "application/json" }),
      },
      ...(request.body === null ? {} : { body: JSON.stringify(request.body) }),
      signal: AbortSignal.timeout(writeTimeoutMs),
    });
  } catch (error) {
    throw new EvaError("google_failed", "Eva could not reach Google. Check the machine's internet connection.", {
      cause: error,
    });
  }
  // A delete answers with no body.
  const answer = (await response.json().catch(() => null)) as unknown;
  if (response.ok) return { item: typeof answer === "object" && answer !== null ? answer : null };
  const refused = refusalOf(response.status, answer);
  if (refused !== null) return { refused };
  // Only the status: the answer can hold the event's text, which must not reach a log.
  throw new EvaError("google_failed", `Google refused to change the calendar (HTTP ${String(response.status)}).`);
}

function refusalOf(status: number, answer: unknown): CalendarRefusal | null {
  if (status === 400) return "invalid";
  if (status === 401) return "logIn";
  if (status === 404 || status === 410) return "notFound";
  if (status !== 403) return null;
  const errors = (answer as { error?: { errors?: unknown } } | null)?.error?.errors;
  const reasons = Array.isArray(errors)
    ? (errors as unknown[]).map((each) => String((each as { reason?: unknown } | null)?.reason))
    : [];
  if (reasons.some((reason) => limitReasons.has(reason))) return null;
  // A token without the scope that the write needs: only a new login gives it.
  if (reasons.includes("insufficientPermissions")) return "logIn";
  return "notAllowed";
}

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
  readonly accessRole?: unknown;
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
    writable: entry.accessRole === "owner" || entry.accessRole === "writer",
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
