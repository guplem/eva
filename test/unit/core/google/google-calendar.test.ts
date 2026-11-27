import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoogleCalendar, type GoogleCalendarInputs } from "../../../../src/core/google/google-calendar.ts";
import { googleScopes } from "../../../../src/core/google/google-scopes.ts";
import { defaultConfig } from "../../../../src/core/settings/home.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { fakeGoogle, type FakeGoogle } from "../../../support/fake-google.ts";

const client = {
  clientId: "123456789012-clientid.apps.googleusercontent.com",
  clientSecret: "GOCSPX-client-secret-value",
};
const config = { ...defaultConfig.google, email: "person@example.com", services: ["calendar" as const] };

const work = {
  id: "work@example.com",
  summary: "person@example.com",
  summaryOverride: "Work",
  backgroundColor: "#3f51b5",
  primary: true,
  selected: true,
  timeZone: "Europe/Madrid",
  accessRole: "owner",
};
const family = {
  id: "family-id@group.calendar.google.com",
  summary: "Family",
  backgroundColor: "#e67c73",
  selected: true,
  accessRole: "reader",
};
const hidden = { id: "holidays@group.v.calendar.google.com", summary: "Holidays", backgroundColor: "#0b8043" };

let folder: string;
let google: FakeGoogle;
let inputs: GoogleCalendarInputs;
let now: Date;
let calendar: GoogleCalendar;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-google-calendar-"));
  google = fakeGoogle();
  google.calendarList = [work, family, hidden];
  inputs = { config, client, credentialsFolder: folder, baseUrl: google.url };
  now = new Date("2026-11-18T08:00:00Z");
  calendar = new GoogleCalendar({ inputs: () => inputs, now: () => now });
  writeFileSync(
    join(folder, "person@example.com.json"),
    JSON.stringify({
      token: null,
      refresh_token: "the-refresh-token",
      token_uri: "https://oauth2.googleapis.com/token",
      client_id: client.clientId,
      client_secret: client.clientSecret,
      scopes: googleScopes(config),
      expiry: null,
    }),
  );
});
afterEach(() => {
  google.stop();
  rmSync(folder, { recursive: true, force: true });
});

function eventQueries(): URLSearchParams[] {
  return google.apiQueries.filter(({ path }) => path.endsWith("/events")).map(({ query }) => query);
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isEvaError(error, "google_failed")) return error.message;
    throw error;
  }
  throw new Error("The call did not fail.");
}

describe("the calendars", () => {
  test("lists each calendar that the person shows, with its own name and color", async () => {
    expect(await calendar.calendars()).toEqual([
      { id: "work@example.com", name: "Work", color: "#3f51b5", primary: true, writable: true },
      { id: "family-id@group.calendar.google.com", name: "Family", color: "#e67c73", primary: false, writable: false },
    ]);
  });

  test("say that a calendar is writable only when the person owns it or may write to it", async () => {
    google.calendarList = ["owner", "writer", "reader", "freeBusyReader", undefined].map((accessRole, index) => ({
      id: `calendar-${String(index)}`,
      selected: true,
      ...(accessRole === undefined ? {} : { accessRole }),
    }));
    expect((await calendar.calendars())?.map((each) => each.writable)).toEqual([true, true, false, false, false]);
  });

  test("answer null with Calendar off or no Google login, with no call to Google", async () => {
    inputs = { ...inputs, config: { ...config, services: ["drive"] } };
    expect(await calendar.calendars()).toBeNull();
    inputs = { ...inputs, config: { ...config, email: null } };
    expect(await calendar.calendars()).toBeNull();
    expect(google.tokenRequests).toHaveLength(0);
  });

  test("answer null when the login on this machine does not work", async () => {
    rmSync(join(folder, "person@example.com.json"));
    expect(await calendar.calendars()).toBeNull();
    expect(google.apiRequests).toHaveLength(0);
  });

  test("throw when Google refuses, and keep no failure in the cache", async () => {
    google.apiStatus = 500;
    const message = await failure(calendar.calendars());
    expect(message).toContain("HTTP 500");
    expect(message).not.toContain("the-access-token");
    google.apiStatus = null;
    expect(await calendar.calendars()).toHaveLength(2);
  });
});

describe("the events", () => {
  test("give the events of each shown calendar in the contract's shape, sorted by start", async () => {
    google.calendarEvents.set(work.id, [
      {
        id: "standup",
        status: "confirmed",
        summary: "Standup",
        location: "Room B",
        description: "Daily sync.<br>Bring <b>notes</b> &amp; questions.",
        htmlLink: "https://www.google.com/calendar/event?eid=standup",
        start: { dateTime: "2026-11-18T09:00:00+01:00" },
        end: { dateTime: "2026-11-18T09:15:00+01:00" },
        attendees: [{ email: "person@example.com", self: true, responseStatus: "accepted" }],
      },
      { id: "gone", status: "cancelled", start: { dateTime: "2026-11-18T10:00:00+01:00" } },
      { id: "office", eventType: "workingLocation", summary: "Office", start: { date: "2026-11-18" } },
      {
        id: "declined",
        summary: "Declined",
        start: { dateTime: "2026-11-18T11:00:00+01:00" },
        end: { dateTime: "2026-11-18T12:00:00+01:00" },
        attendees: [{ email: "person@example.com", self: true, responseStatus: "declined" }],
      },
    ]);
    google.calendarEvents.set(family.id, [
      { id: "trip", summary: "Trip", start: { date: "2026-11-18" }, end: { date: "2026-11-20" } },
      {
        id: "untitled",
        start: { dateTime: "2026-11-18T08:00:00+01:00" },
        end: { dateTime: "2026-11-18T08:30:00+01:00" },
      },
      { id: "broken" },
    ]);
    google.calendarEvents.set(hidden.id, [{ id: "hidden", summary: "Hidden", start: { date: "2026-11-18" } }]);

    expect(await calendar.events("2026-11-18", "2026-11-19")).toEqual([
      {
        id: "trip",
        calendarId: family.id,
        title: "Trip",
        date: "2026-11-18",
        endDate: "2026-11-19",
        place: null,
        link: null,
        description: null,
      },
      {
        id: "untitled",
        calendarId: family.id,
        title: "",
        startAt: "2026-11-18T08:00:00+01:00",
        endAt: "2026-11-18T08:30:00+01:00",
        place: null,
        link: null,
        description: null,
      },
      {
        id: "standup",
        calendarId: work.id,
        title: "Standup",
        startAt: "2026-11-18T09:00:00+01:00",
        endAt: "2026-11-18T09:15:00+01:00",
        place: "Room B",
        link: "https://www.google.com/calendar/event?eid=standup",
        description: "Daily sync.\nBring notes & questions.",
      },
    ]);
  });

  test("ask Google for whole days in the time zone of the main calendar, also on the day the clocks change", async () => {
    await calendar.events("2026-03-28", "2026-03-29");
    const [query] = eventQueries();
    expect(query?.get("timeMin")).toBe("2026-03-27T23:00:00.000Z");
    // Madrid moves to summer time on 29 March: that day ends at 22:00 UTC.
    expect(query?.get("timeMax")).toBe("2026-03-29T22:00:00.000Z");
    expect(query?.get("timeZone")).toBe("Europe/Madrid");
    expect(query?.get("singleEvents")).toBe("true");
    expect(eventQueries()).toHaveLength(2);
  });

  test("use UTC when the main calendar has no time zone that Eva knows", async () => {
    google.calendarList = [{ ...work, timeZone: "Not/AZone" }];
    await calendar.events("2026-11-18", "2026-11-18");
    expect(eventQueries()[0]?.get("timeMin")).toBe("2026-11-18T00:00:00.000Z");
  });

  test("read every page of a long calendar", async () => {
    google.eventPageSize = 2;
    google.calendarList = [work];
    google.calendarEvents.set(
      work.id,
      ["a", "b", "c"].map((id, index) => ({ id, summary: id, start: { date: `2026-11-1${String(index + 1)}` } })),
    );
    expect((await calendar.events("2026-11-11", "2026-11-13"))?.map((event) => event.id)).toEqual(["a", "b", "c"]);
    expect(eventQueries().map((query) => query.get("pageToken"))).toEqual([null, "2"]);
  });

  test("keep an answer for a minute, and share one call among widgets that ask at once", async () => {
    await Promise.all([calendar.events("2026-11-18", "2026-11-18"), calendar.events("2026-11-18", "2026-11-18")]);
    await calendar.calendars();
    const calls = google.apiRequests.length;
    expect(calls).toBe(3);
    now = new Date(now.getTime() + 59_000);
    await calendar.events("2026-11-18", "2026-11-18");
    expect(google.apiRequests).toHaveLength(calls);
    now = new Date(now.getTime() + 1_000);
    await calendar.events("2026-11-18", "2026-11-18");
    expect(google.apiRequests).toHaveLength(calls * 2);
  });

  test("answer null with Calendar off", async () => {
    inputs = { ...inputs, config: { ...config, services: ["drive"] } };
    expect(await calendar.events("2026-11-18", "2026-11-18")).toBeNull();
    expect(google.apiRequests).toHaveLength(0);
  });

  test("answer null when Google refuses the login, and throw when Google refuses the events", async () => {
    google.tokenError = "invalid_grant";
    expect(await calendar.events("2026-11-18", "2026-11-18")).toBeNull();
    google.tokenError = null;
    now = new Date(now.getTime() + 60_000);
    await calendar.calendars();
    google.apiStatus = 403;
    expect(await failure(calendar.events("2026-11-18", "2026-11-18"))).toContain("HTTP 403");
  });
});

describe("the writes", () => {
  const meeting = {
    calendarId: work.id,
    title: "Planning",
    place: "Room B",
    description: "Bring the plan.",
    time: { startAt: "2026-11-19T10:00:00+01:00", endAt: "2026-11-19T11:00:00+01:00" },
  };

  /** Calendar at "Read and change" in Settings, with a login that gives that access. */
  function allowWrites(): void {
    const full = { ...config, access: { ...config.access, calendar: "full" as const } };
    inputs = { ...inputs, config: full };
    writeLogin(googleScopes(full));
  }

  function writeLogin(scopes: readonly string[]): void {
    writeFileSync(
      join(folder, "person@example.com.json"),
      JSON.stringify({
        token: null,
        refresh_token: "the-refresh-token",
        token_uri: "https://oauth2.googleapis.com/token",
        client_id: client.clientId,
        client_secret: client.clientSecret,
        scopes,
        expiry: null,
      }),
    );
  }

  test("create a timed event with no invitation, and give it in the contract's shape", async () => {
    allowWrites();
    const result = await calendar.create(meeting, false);
    expect(google.calendarWrites).toHaveLength(1);
    const [write] = google.calendarWrites;
    expect(write?.method).toBe("POST");
    expect(write?.path).toBe("/calendar/v3/calendars/work%40example.com/events");
    expect(write?.query.get("sendUpdates")).toBe("none");
    expect(write?.body).toEqual({
      summary: "Planning",
      location: "Room B",
      description: "Bring the plan.",
      start: { dateTime: "2026-11-19T10:00:00+01:00" },
      end: { dateTime: "2026-11-19T11:00:00+01:00" },
    });
    expect(result).toEqual({
      done: {
        id: "created-1",
        calendarId: work.id,
        title: "Planning",
        startAt: "2026-11-19T10:00:00+01:00",
        endAt: "2026-11-19T11:00:00+01:00",
        place: "Room B",
        link: "https://www.google.com/calendar/event?eid=created-1",
        description: "Bring the plan.",
      },
    });
  });

  test("create an all-day event, with Google's end day after the last day", async () => {
    allowWrites();
    const result = await calendar.create(
      { calendarId: work.id, title: "Trip", time: { date: "2026-11-21", endDate: "2026-11-22" } },
      false,
    );
    expect(google.calendarWrites[0]?.body).toEqual({
      summary: "Trip",
      start: { date: "2026-11-21" },
      end: { date: "2026-11-23" },
    });
    expect(result).toMatchObject({ done: { date: "2026-11-21", endDate: "2026-11-22" } });
  });

  test("send invitations to the guests only when the widget asks", async () => {
    allowWrites();
    const guests = ["guest@example.com", "other@example.com"];
    await calendar.create({ ...meeting, guests }, false);
    await calendar.create({ ...meeting, guests: [...guests, "GUEST@example.com"] }, true);
    expect(google.calendarWrites.map((write) => write.query.get("sendUpdates"))).toEqual(["none", "all"]);
    expect(google.calendarWrites[1]?.body).toMatchObject({
      attendees: [{ email: "guest@example.com" }, { email: "other@example.com" }],
    });
  });

  test("refuse with Calendar at read only in Settings, with no call to Google", async () => {
    expect(await calendar.create(meeting, true)).toEqual({ refused: "readOnly" });
    expect(await calendar.change("standup", { calendarId: work.id, title: "New" }, true)).toEqual({
      refused: "readOnly",
    });
    expect(await calendar.remove(work.id, "standup", true)).toEqual({ refused: "readOnly" });
    expect(google.tokenRequests).toHaveLength(0);
    expect(google.apiRequests).toHaveLength(0);
  });

  test("refuse with Calendar off or no Google account, with no call to Google", async () => {
    allowWrites();
    const on = inputs.config;
    inputs = { ...inputs, config: { ...on, services: ["drive"] } };
    expect(await calendar.create(meeting, false)).toEqual({ refused: "calendarOff" });
    inputs = { ...inputs, config: { ...on, email: null } };
    expect(await calendar.remove(work.id, "standup", false)).toEqual({ refused: "calendarOff" });
    expect(google.tokenRequests).toHaveLength(0);
    expect(google.apiRequests).toHaveLength(0);
  });

  test("ask for a new login after a change to Read and change with the old login", async () => {
    allowWrites();
    // The login of the read-only level: Google gave no scope that writes.
    writeLogin(googleScopes(config));
    expect(await calendar.create(meeting, false)).toEqual({ refused: "logIn" });
    expect(google.apiRequests).toHaveLength(0);
  });

  test("refuse a calendar that the person does not show, with no write", async () => {
    allowWrites();
    expect(await calendar.create({ ...meeting, calendarId: hidden.id }, false)).toEqual({ refused: "notFound" });
    expect(await calendar.remove("someone-else@example.com", "standup", false)).toEqual({ refused: "notFound" });
    expect(google.calendarWrites).toHaveLength(0);
  });

  test("change only the fields that the widget gives", async () => {
    allowWrites();
    google.calendarEvents.set(work.id, [
      {
        id: "standup",
        summary: "Standup",
        location: "Room B",
        description: "<b>Agenda</b>",
        attendees: [{ email: "guest@example.com" }],
        start: { dateTime: "2026-11-18T09:00:00+01:00" },
        end: { dateTime: "2026-11-18T09:15:00+01:00" },
      },
    ]);
    const result = await calendar.change(
      "standup",
      { calendarId: work.id, title: "Daily", place: null, description: null },
      false,
    );
    const [write] = google.calendarWrites;
    expect(write?.method).toBe("PATCH");
    expect(write?.path).toBe("/calendar/v3/calendars/work%40example.com/events/standup");
    expect(write?.query.get("sendUpdates")).toBe("none");
    expect(write?.body).toEqual({ summary: "Daily", location: "", description: "" });
    expect(result).toMatchObject({ done: { id: "standup", title: "Daily", place: null, description: null } });
    expect(google.calendarEvents.get(work.id)?.[0]).toMatchObject({ attendees: [{ email: "guest@example.com" }] });
  });

  test("change a timed event into an all-day event", async () => {
    allowWrites();
    google.calendarEvents.set(work.id, [
      {
        id: "standup",
        summary: "Standup",
        start: { dateTime: "2026-11-18T09:00:00+01:00" },
        end: { dateTime: "2026-11-18T09:15:00+01:00" },
      },
    ]);
    const result = await calendar.change(
      "standup",
      { calendarId: work.id, time: { date: "2026-11-18", endDate: "2026-11-18" } },
      true,
    );
    expect(google.calendarWrites[0]?.query.get("sendUpdates")).toBe("all");
    // A patch merges `start`: the old time must go, or Google keeps both.
    expect(google.calendarWrites[0]?.body).toEqual({
      start: { date: "2026-11-18", dateTime: null },
      end: { date: "2026-11-19", dateTime: null },
    });
    expect(result).toMatchObject({ done: { date: "2026-11-18", endDate: "2026-11-18" } });
    expect(result).not.toMatchObject({ done: { startAt: expect.anything() as unknown } });
  });

  test("change an all-day event into a timed event", async () => {
    allowWrites();
    google.calendarEvents.set(work.id, [
      { id: "trip", summary: "Trip", start: { date: "2026-11-18" }, end: { date: "2026-11-19" } },
    ]);
    const result = await calendar.change("trip", { calendarId: work.id, time: meeting.time }, false);
    expect(google.calendarWrites[0]?.body).toEqual({
      start: { dateTime: "2026-11-19T10:00:00+01:00", date: null },
      end: { dateTime: "2026-11-19T11:00:00+01:00", date: null },
    });
    expect(result).toMatchObject({
      done: { startAt: "2026-11-19T10:00:00+01:00", endAt: "2026-11-19T11:00:00+01:00" },
    });
  });

  test("delete an event, and send the cancellation only when the widget asks", async () => {
    allowWrites();
    google.calendarEvents.set(work.id, [{ id: "a" }, { id: "b" }]);
    expect(await calendar.remove(work.id, "a", false)).toEqual({ done: null });
    expect(await calendar.remove(work.id, "b", true)).toEqual({ done: null });
    expect(google.calendarWrites.map((write) => [write.method, write.query.get("sendUpdates")])).toEqual([
      ["DELETE", "none"],
      ["DELETE", "all"],
    ]);
    expect(google.calendarEvents.get(work.id)).toEqual([]);
  });

  test("encode the calendar and the event in Google's address", async () => {
    allowWrites();
    google.calendarList = [{ ...work, id: "a/../b?c#d@example.com" }];
    google.calendarEvents.set("a/../b?c#d@example.com", [{ id: "x/../y?z" }]);
    expect(await calendar.remove("a/../b?c#d@example.com", "x/../y?z", false)).toEqual({ done: null });
    expect(google.calendarWrites[0]?.path).toBe(
      "/calendar/v3/calendars/a%2F..%2Fb%3Fc%23d%40example.com/events/x%2F..%2Fy%3Fz",
    );
    expect([...(google.calendarWrites[0]?.query.keys() ?? [])]).toEqual(["sendUpdates"]);
  });

  test("give each refusal of Google its reason, and throw when Google fails", async () => {
    allowWrites();
    const writes = [
      (): Promise<unknown> => calendar.create(meeting, false),
      (): Promise<unknown> => calendar.change("standup", { calendarId: work.id, title: "New" }, false),
      (): Promise<unknown> => calendar.remove(work.id, "standup", false),
    ];
    const table: [number, string, string][] = [
      [400, "invalid", "invalid"],
      [401, "authError", "logIn"],
      [403, "insufficientPermissions", "logIn"],
      [403, "forbidden", "notAllowed"],
      [403, "requiredAccessLevel", "notAllowed"],
      [403, "", "notAllowed"],
      [404, "notFound", "notFound"],
      [410, "deleted", "notFound"],
    ];
    for (const send of writes) {
      for (const [status, reason, refused] of table) {
        google.calendarWriteStatus = { status, reason };
        expect({ status, reason, answer: await send() }).toEqual({ status, reason, answer: { refused } });
      }
      google.calendarWriteStatus = { status: 403, reason: "rateLimitExceeded" };
      expect(await failure(send())).toContain("HTTP 403");
    }
  });

  test("give Google's own refusals: a calendar that the person may only read, and an event already deleted", async () => {
    allowWrites();
    expect(await calendar.create({ ...meeting, calendarId: family.id }, false)).toEqual({ refused: "notAllowed" });
    google.calendarEvents.set(work.id, [{ id: "a" }]);
    expect(await calendar.remove(work.id, "a", false)).toEqual({ done: null });
    expect(await calendar.remove(work.id, "a", false)).toEqual({ refused: "notFound" });
    expect(google.calendarWrites.map((write) => write.method)).toEqual(["POST", "DELETE", "DELETE"]);
  });

  test("throw when the connection drops during a write", async () => {
    allowWrites();
    google.calendarWriteDropped = true;
    expect(await failure(calendar.create(meeting, false))).toContain("could not reach Google");
  });

  test("keep the event text, Google's text and the token out of a failure", async () => {
    allowWrites();
    google.calendarWriteStatus = { status: 500, reason: "backendError", message: "Planning in Room B failed" };
    const message = await failure(calendar.create({ ...meeting, guests: ["guest@example.com"] }, true));
    expect(message).toContain("HTTP 500");
    for (const secret of ["Planning", "Room B", "Bring the plan", "guest@example.com", "the-access-token"])
      expect(message).not.toContain(secret);
  });

  test("show the widget its own change at once, with no wait for the cache", async () => {
    allowWrites();
    expect(await calendar.events("2026-11-19", "2026-11-19")).toEqual([]);
    await calendar.create(meeting, false);
    expect((await calendar.events("2026-11-19", "2026-11-19"))?.map((event) => event.title)).toEqual(["Planning"]);
    await calendar.remove(work.id, "created-1", false);
    expect(await calendar.events("2026-11-19", "2026-11-19")).toEqual([]);
  });

  test("forget the cache also after a write that failed, which Google may have made", async () => {
    allowWrites();
    expect(await calendar.events("2026-11-19", "2026-11-19")).toEqual([]);
    google.calendarWriteStatus = { status: 503, reason: "backendError" };
    await failure(calendar.create(meeting, false));
    google.calendarWriteStatus = null;
    google.calendarEvents.set(work.id, [
      { id: "made", summary: "Made", start: { date: "2026-11-19" }, end: { date: "2026-11-20" } },
    ]);
    expect((await calendar.events("2026-11-19", "2026-11-19"))?.map((event) => event.id)).toEqual(["made"]);
  });
});
