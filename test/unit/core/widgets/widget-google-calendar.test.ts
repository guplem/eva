import { describe, expect, test } from "bun:test";
import {
  noCalendar,
  type CalendarSource,
  type CalendarWrite,
  type EventChange,
  type NewEvent,
  type WidgetCalendarEvent,
} from "../../../../src/core/google/google-calendar.ts";
import { calendarWriteAnswer, maxEventWriteBytes } from "../../../../src/core/widgets/widget-google-calendar.ts";
import type { WidgetAnswer } from "../../../../src/core/widgets/widget-data.ts";
import { EvaError } from "../../../../src/shared/errors.ts";

interface Call {
  readonly kind: "create" | "change" | "remove";
  readonly id?: string;
  readonly event?: NewEvent | EventChange;
  readonly calendarId?: string;
  readonly sendInvitations: boolean;
}

const created: WidgetCalendarEvent = {
  id: "created-1",
  calendarId: "work@example.com",
  title: "Planning",
  startAt: "2026-11-19T10:00:00+01:00",
  endAt: "2026-11-19T11:00:00+01:00",
  place: null,
  link: "https://www.google.com/calendar/event?eid=created-1",
  description: "Plan it.\n[eva-project:missing]",
};

/** A source that records each write and answers with `result`. */
function recordingSource(result: () => Promise<CalendarWrite<WidgetCalendarEvent | null>> = done): {
  readonly source: CalendarSource;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  const source: CalendarSource = {
    ...noCalendar,
    create: (event, sendInvitations) => {
      calls.push({ kind: "create", event, sendInvitations });
      return result();
    },
    change: (id, event, sendInvitations) => {
      calls.push({ kind: "change", id, event, sendInvitations });
      return result();
    },
    remove: async (calendarId, id, sendInvitations) => {
      calls.push({ kind: "remove", id, calendarId, sendInvitations });
      const answer = await result();
      return "refused" in answer ? answer : { done: null };
    },
  };
  return { source, calls };
}

function done(): Promise<CalendarWrite<WidgetCalendarEvent | null>> {
  return Promise.resolve({ done: created });
}

const timed = {
  calendarId: "work@example.com",
  title: "Planning",
  startAt: "2026-11-19T10:00:00+01:00",
  endAt: "2026-11-19T11:00:00+01:00",
};

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
}

function write(
  source: CalendarSource,
  method: string,
  path: string,
  body: unknown = null,
  options: { readonly query?: string; readonly access?: "read" | "write" | null } = {},
): Promise<WidgetAnswer | null> {
  return calendarWriteAnswer({
    path,
    method,
    query: new URLSearchParams(options.query ?? ""),
    body: body === null ? null : bytes(body),
    access: options.access === undefined ? "write" : options.access,
    source,
    projects: () => [],
  });
}

function json(answer: WidgetAnswer | null): unknown {
  return JSON.parse(typeof answer?.body === "string" ? answer.body : new TextDecoder().decode(answer?.body));
}

const events = "eva/google-calendar/events.json";
const standup = "eva/google-calendar/events/standup.json";

describe("the calendar writes of a widget", () => {
  test("create an event, and answer 201 with it in the read shape", async () => {
    const { source, calls } = recordingSource();
    const answer = await write(source, "POST", events, { ...timed, place: "Room B", id: "x", link: "y" });
    expect(answer?.status).toBe(201);
    expect(json(answer)).toEqual({ ...created, description: "Plan it.", project: null });
    expect(calls).toEqual([
      {
        kind: "create",
        event: {
          calendarId: "work@example.com",
          title: "Planning",
          place: "Room B",
          time: { startAt: "2026-11-19T10:00:00+01:00", endAt: "2026-11-19T11:00:00+01:00" },
        },
        sendInvitations: false,
      },
    ]);
  });

  test("create an all-day event", async () => {
    const { source, calls } = recordingSource();
    const body = { calendarId: "work@example.com", title: "Trip", date: "2026-11-21", endDate: "2026-11-22" };
    expect((await write(source, "POST", events, body))?.status).toBe(201);
    expect(calls[0]?.event?.time).toEqual({ date: "2026-11-21", endDate: "2026-11-22" });
  });

  test("send invitations only for `sendInvitations: true`", async () => {
    const { source, calls } = recordingSource();
    const guests = ["guest@example.com"];
    await write(source, "POST", events, { ...timed, guests });
    await write(source, "POST", events, { ...timed, guests, sendInvitations: false });
    await write(source, "POST", events, { ...timed, guests, sendInvitations: true });
    await write(source, "PUT", standup, { calendarId: "work@example.com", sendInvitations: true });
    expect(calls.map((call) => call.sendInvitations)).toEqual([false, false, true, true]);
    expect((calls[0]?.event as NewEvent | undefined)?.guests).toEqual(guests);
    for (const choice of ["true", 1, "yes", null])
      expect((await write(source, "POST", events, { ...timed, guests, sendInvitations: choice }))?.status).toBe(400);
    expect(calls).toHaveLength(4);
  });

  test("refuse guests in a change: the reads give none, so a change would drop the others", async () => {
    const { source, calls } = recordingSource();
    const body = { calendarId: "work@example.com", guests: ["guest@example.com"] };
    expect((await write(source, "PUT", standup, body))?.status).toBe(400);
    expect(calls).toEqual([]);
  });

  test("change an event with only the fields that the widget gives", async () => {
    const { source, calls } = recordingSource();
    const answer = await write(source, "PUT", standup, { calendarId: "work@example.com", place: null });
    expect(answer?.status).toBe(200);
    expect(calls).toEqual([
      { kind: "change", id: "standup", event: { calendarId: "work@example.com", place: null }, sendInvitations: false },
    ]);
  });

  test("delete an event, with the calendar and the choice in the query", async () => {
    const { source, calls } = recordingSource();
    const remove = (query: string): Promise<WidgetAnswer | null> => write(source, "DELETE", standup, null, { query });
    expect(await remove("calendarId=work%40example.com")).toEqual({ status: 204 });
    expect((await remove("calendarId=work%40example.com&sendInvitations=true"))?.status).toBe(204);
    expect((await remove("calendarId=work%40example.com&sendInvitations=false"))?.status).toBe(204);
    expect(calls.map((call) => [call.calendarId, call.id, call.sendInvitations])).toEqual([
      ["work@example.com", "standup", false],
      ["work@example.com", "standup", true],
      ["work@example.com", "standup", false],
    ]);
    for (const query of ["", "calendarId=", "calendarId=work%40example.com&sendInvitations=yes"])
      expect({ query, status: (await remove(query))?.status }).toEqual({ query, status: 400 });
    expect(calls).toHaveLength(3);
  });

  test("a widget with read access gets 405 on each write, and Eva never writes", async () => {
    const { source, calls } = recordingSource();
    const options = { access: "read" as const, query: "calendarId=work%40example.com" };
    expect((await write(source, "POST", events, timed, options))?.status).toBe(405);
    expect((await write(source, "PUT", standup, timed, options))?.status).toBe(405);
    expect((await write(source, "DELETE", standup, null, options))?.status).toBe(405);
    expect(calls).toEqual([]);
  });

  test("a widget with no calendar input gets 404, and Eva never writes", async () => {
    const { source, calls } = recordingSource();
    expect((await write(source, "POST", events, timed, { access: null }))?.status).toBe(404);
    expect((await write(source, "DELETE", standup, null, { access: null }))?.status).toBe(404);
    expect(calls).toEqual([]);
  });

  test("answer 405 for a method that a path does not take", async () => {
    const { source, calls } = recordingSource();
    expect((await write(source, "PUT", events, timed))?.status).toBe(405);
    expect((await write(source, "DELETE", events, null))?.status).toBe(405);
    expect((await write(source, "POST", standup, timed))?.status).toBe(405);
    expect((await write(source, "PATCH", standup, timed))?.status).toBe(405);
    expect(calls).toEqual([]);
  });

  test("leave a read and every other path to the caller", async () => {
    const { source } = recordingSource();
    expect(await write(source, "GET", events)).toBeNull();
    expect(await write(source, "HEAD", standup)).toBeNull();
    // The caller answers 405 to each write of a read path, as before.
    expect(await write(source, "POST", "eva/google-calendar/calendars.json", timed)).toBeNull();
    expect(await write(source, "POST", "eva/google-tasks/tasks.json", timed)).toBeNull();
    expect(await write(source, "POST", "data/habits/walk.json", timed)).toBeNull();
  });

  test("refuse an event id that could leave its place in Google's address, with 404", async () => {
    const { source, calls } = recordingSource();
    for (const id of ["a/b", "..", "a?b", "a#b", "a%2Fb", "a.b", "", "x".repeat(1025)]) {
      const path = `eva/google-calendar/events/${id}.json`;
      expect({ id, status: (await write(source, "PUT", path, timed))?.status }).toEqual({ id, status: 404 });
      const remove = await write(source, "DELETE", path, null, { query: "calendarId=work%40example.com" });
      expect({ id, status: remove?.status }).toEqual({ id, status: 404 });
      expect((await write(source, "PUT", path, timed, { access: "read" }))?.status).toBe(405);
    }
    expect(calls).toEqual([]);
  });

  test("refuse a body that is not an event, with 400", async () => {
    const { source, calls } = recordingSource();
    const bodies: unknown[] = [
      "not json",
      "[]",
      "null",
      { ...timed, calendarId: "" },
      { title: "No calendar", startAt: timed.startAt, endAt: timed.endAt },
      { calendarId: "work@example.com", title: "No time" },
      { ...timed, endAt: "2026-11-19T09:00:00+01:00" },
      { ...timed, startAt: "2026-11-19T10:00:00" },
      { ...timed, startAt: "2026-11-19T10:00+01:00" },
      { ...timed, startAt: "2026-02-30T10:00:00Z", endAt: "2026-03-03T10:00:00Z" },
      { ...timed, startAt: "2026-11-19T24:00:00Z", endAt: "2026-11-20T10:00:00Z" },
      { ...timed, startAt: "tomorrow" },
      { ...timed, date: "2026-11-19", endDate: "2026-11-19" },
      { calendarId: "work@example.com", date: "2026-11-19" },
      { calendarId: "work@example.com", date: "2026-02-30", endDate: "2026-03-01" },
      { calendarId: "work@example.com", date: "2026-11-20", endDate: "2026-11-19" },
      { ...timed, title: 7 },
      { ...timed, title: "x".repeat(1025) },
      { ...timed, place: "x".repeat(1025) },
      { ...timed, description: "x".repeat(8193) },
      { ...timed, guests: "guest@example.com" },
      { ...timed, guests: ["not an email"] },
      { ...timed, guests: ["guest@example.com, other@example.com"] },
      { ...timed, guests: ["<guest@example.com>"] },
      { ...timed, guests: Array.from({ length: 101 }, (_, index) => `guest${String(index)}@example.com`) },
    ];
    for (const body of bodies)
      expect({ body, status: (await write(source, "POST", events, body))?.status }).toEqual({ body, status: 400 });
    expect({ status: (await write(source, "POST", events, null))?.status }).toEqual({ status: 400 });
    expect(calls).toEqual([]);
  });

  test("accept 100 guests and a description of 8192 characters", async () => {
    const { source, calls } = recordingSource();
    const guests = Array.from({ length: 100 }, (_, index) => `guest${String(index)}@example.com`);
    const body = { ...timed, guests, description: "x".repeat(8192) };
    expect((await write(source, "POST", events, body))?.status).toBe(201);
    expect(calls).toHaveLength(1);
  });

  test("accept each field and the body at its exact limit", async () => {
    const { source, calls } = recordingSource();
    const email = `${"g".repeat(254 - "@example.com".length)}@example.com`;
    const atLimits = { ...timed, title: "t".repeat(1024), place: "p".repeat(1024), guests: [email] };
    expect((await write(source, "POST", events, atLimits))?.status).toBe(201);
    expect((await write(source, "POST", events, { ...timed, guests: [`g${email}`] }))?.status).toBe(400);
    const padding = maxEventWriteBytes - JSON.stringify({ ...timed, note: "" }).length;
    expect((await write(source, "POST", events, JSON.stringify({ ...timed, note: "x".repeat(padding) })))?.status).toBe(
      201,
    );
    const calendarId = "c".repeat(1024);
    expect((await write(source, "POST", events, { ...timed, calendarId }))?.status).toBe(201);
    expect((await write(source, "POST", events, { ...timed, calendarId: `${calendarId}c` }))?.status).toBe(400);
    const longId = `eva/google-calendar/events/${"e".repeat(1024)}.json`;
    const remove = (id: string): Promise<WidgetAnswer | null> =>
      write(source, "DELETE", longId, null, { query: `calendarId=${id}` });
    expect((await remove(calendarId))?.status).toBe(204);
    expect((await remove(`${calendarId}c`))?.status).toBe(400);
    expect(calls).toHaveLength(4);
  });

  test("refuse a body over the cap, with 413", async () => {
    const { source, calls } = recordingSource();
    const body = JSON.stringify({ ...timed, extra: "x".repeat(maxEventWriteBytes) });
    expect((await write(source, "POST", events, body))?.status).toBe(413);
    expect(calls).toEqual([]);
  });

  test("give each refusal its status, with the reason that the widget shows", async () => {
    const answers = new Map<string, WidgetAnswer | null>();
    for (const refused of ["calendarOff", "readOnly", "logIn", "notAllowed", "notFound", "invalid"] as const) {
      const { source } = recordingSource(() => Promise.resolve({ refused }));
      answers.set(refused, await write(source, "POST", events, timed));
    }
    for (const reason of ["calendarOff", "readOnly", "logIn", "notAllowed"]) {
      expect(answers.get(reason)?.status).toBe(403);
      expect(json(answers.get(reason) ?? null)).toEqual({ reason });
    }
    expect(answers.get("notFound")).toEqual({ status: 404 });
    expect(answers.get("invalid")).toEqual({ status: 400 });
  });

  test("answer 502 when Google fails, and let another error through", async () => {
    const failed = recordingSource(() => Promise.reject(new EvaError("google_failed", "Google refused (HTTP 500).")));
    expect((await write(failed.source, "POST", events, timed))?.status).toBe(502);
    const broken = recordingSource(() => Promise.reject(new Error("a bug")));
    let thrown: unknown = null;
    await write(broken.source, "POST", events, timed).catch((error: unknown) => (thrown = error));
    expect(thrown).toBeInstanceOf(Error);
  });

  test("answer null for a new event that Eva cannot read", async () => {
    const { source } = recordingSource(() => Promise.resolve({ done: null }));
    const answer = await write(source, "POST", events, timed);
    expect(answer?.status).toBe(201);
    expect(json(answer)).toBeNull();
  });

  test("Eva with no Google refuses each write as Calendar off", async () => {
    expect(json(await write(noCalendar, "POST", events, timed))).toEqual({ reason: "calendarOff" });
    expect(json(await write(noCalendar, "PUT", standup, timed))).toEqual({ reason: "calendarOff" });
    const answer = await write(noCalendar, "DELETE", standup, null, { query: "calendarId=work%40example.com" });
    expect(json(answer)).toEqual({ reason: "calendarOff" });
  });
});
