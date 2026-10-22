import { describe, expect, test } from "bun:test";
import { smartName } from "../../../../../src/frontends/web/client/smart-names.ts";

describe("smartName: a date at the start", () => {
  test("a year moves to the date, and the badge carries the extension (issue 429)", () => {
    expect(smartName("2027-trips.md", { badge: true })).toEqual({ name: "trips", date: "2027" });
  });

  test("each project id precision gives its own date words", () => {
    expect(smartName("2026-03-notes", {})).toEqual({ name: "notes", date: "Mar 2026" });
    expect(smartName("2026-03-02-notes", {})).toEqual({ name: "notes", date: "2 Mar 2026" });
    expect(smartName("2026-03-02-1015-example-app", {})).toEqual({ name: "example-app", date: "2 Mar 2026, 10:15" });
  });

  test("a space or an underscore ends the date too", () => {
    expect(smartName("2026-10-22 Weekly meeting.md", { badge: true })).toEqual({
      name: "Weekly meeting",
      date: "22 Oct 2026",
    });
    expect(smartName("2026_trips", {})).toEqual({ name: "trips", date: "2026" });
  });

  test("a date that cannot exist keeps the shorter date that can", () => {
    expect(smartName("2026-13-things", {})).toEqual({ name: "13-things", date: "2026" });
    expect(smartName("2026-02-30-plan", {})).toEqual({ name: "30-plan", date: "Feb 2026" });
    expect(smartName("2026-03-02-2590-plan", {})).toEqual({ name: "2590-plan", date: "2 Mar 2026" });
  });

  test("a name that is only a date, or no date, stays as it is", () => {
    expect(smartName("2026", {})).toEqual({ name: "2026", date: null });
    expect(smartName("2026-03-02", {})).toEqual({ name: "2026-03-02", date: null });
    expect(smartName("2026-.md", { badge: true })).toEqual({ name: "2026-", date: null });
    expect(smartName("1080p-video.mp4", { badge: true })).toEqual({ name: "1080p-video", date: null });
    expect(smartName("20261022-plan", {})).toEqual({ name: "20261022-plan", date: null });
    expect(smartName("0042-notes", {})).toEqual({ name: "0042-notes", date: null });
  });
});

describe("smartName: the extension", () => {
  test("the extension goes only where a badge shows it", () => {
    expect(smartName("Plan.md", { badge: true })).toEqual({ name: "Plan", date: null });
    expect(smartName("Plan.md", {})).toEqual({ name: "Plan.md", date: null });
    // No badge holds a long extension, so it stays in the name.
    expect(smartName("notes.backup", { badge: true })).toEqual({ name: "notes.backup", date: null });
    expect(smartName(".env", { badge: true })).toEqual({ name: ".env", date: null });
    expect(smartName("Makefile", { badge: true })).toEqual({ name: "Makefile", date: null });
  });
});

describe("smartName: a project folder", () => {
  test("the title is the name, and the folder gives the date", () => {
    expect(smartName("2026-03-02-1015-example-app", { title: "Example app" })).toEqual({
      name: "Example app",
      date: "2 Mar 2026, 10:15",
    });
  });

  test("a blank title falls back to the folder name", () => {
    expect(smartName("2019-03-old-tool", { title: "  " })).toEqual({ name: "old-tool", date: "Mar 2019" });
  });
});
