import { describe, expect, test } from "bun:test";
import { greeting, setupBlock, suggestions } from "../../../../../src/frontends/web/client/new-chat.ts";

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

describe("setupBlock", () => {
  test("names the missing engine and opens its setup step", () => {
    expect(setupBlock("engine")).toEqual({
      sentence: "Eva needs an AI engine before she can answer.",
      action: "Set up an AI engine",
      composerLine: "Set up an AI engine to send a message.",
      address: "#/settings/setup/engine",
    });
  });

  test("names the missing vault and opens its setup step", () => {
    expect(setupBlock("vault")).toMatchObject({
      sentence: "Eva needs your vault before she can answer.",
      action: "Set up your vault",
      address: "#/settings/setup/vault",
    });
  });
});

describe("setupBlock after a new login", () => {
  test("asks for a restart, and opens the Restart card", () => {
    expect(setupBlock("restart")).toEqual({
      sentence: "Eva needs a restart before she can use the new login.",
      action: "Restart Eva",
      composerLine: "Restart Eva to send a message.",
      address: "#/settings/updates/restart",
    });
  });
});
