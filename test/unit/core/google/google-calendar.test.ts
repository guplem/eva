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
};
const family = {
  id: "family-id@group.calendar.google.com",
  summary: "Family",
  backgroundColor: "#e67c73",
  selected: true,
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
      { id: "work@example.com", name: "Work", color: "#3f51b5", primary: true },
      { id: "family-id@group.calendar.google.com", name: "Family", color: "#e67c73", primary: false },
    ]);
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
