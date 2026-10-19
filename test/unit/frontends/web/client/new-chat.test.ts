import { describe, expect, test } from "bun:test";
import { greeting, suggestions } from "../../../../../src/frontends/web/client/new-chat.ts";

describe("greeting", () => {
  test("follows the time of day", () => {
    expect(greeting(5)).toBe("Good morning.");
    expect(greeting(11)).toBe("Good morning.");
    expect(greeting(12)).toBe("Good afternoon.");
    expect(greeting(17)).toBe("Good afternoon.");
    expect(greeting(18)).toBe("Good evening.");
    expect(greeting(23)).toBe("Good evening.");
    expect(greeting(0)).toBe("Good evening.");
    expect(greeting(4)).toBe("Good evening.");
  });
});

describe("suggestions", () => {
  test("offer notes, calendar, projects and reminders, in the order of the design", () => {
    expect(suggestions(true).map((suggestion) => suggestion.icon)).toEqual(["file", "calendar", "folder", "clock"]);
  });

  test("hide the calendar when Google is not set up", () => {
    const shown = suggestions(false);
    expect(shown.map((suggestion) => suggestion.icon)).toEqual(["file", "folder", "clock"]);
  });

  test("each has a title to send and one line that says what Eva does", () => {
    for (const suggestion of suggestions(true)) {
      expect(suggestion.title.length).toBeGreaterThan(0);
      expect(suggestion.detail.length).toBeGreaterThan(0);
    }
  });
});
