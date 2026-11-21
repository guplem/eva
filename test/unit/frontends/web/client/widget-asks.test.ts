import { describe, expect, test } from "bun:test";
import {
  askRequestOf,
  askTextLimit,
  checkAsk,
  openAddressOf,
  textAfterTyped,
} from "../../../../../src/frontends/web/client/widget-asks.ts";

const allowed = { approved: ["chat", "open"] as const, tapped: true, preview: false };

describe("askRequestOf", () => {
  test("reads a message of the contract, and ignores every other message", () => {
    expect(askRequestOf({ eva: "widget", id: 7, ask: "hello" })).toEqual({ id: 7, ask: "hello" });
    expect(askRequestOf({ eva: "widget", id: 8, ask: "chat", text: "Hi" })).toEqual({ id: 8, ask: "chat", text: "Hi" });
    expect(askRequestOf({ eva: "widget", id: 9, ask: "open", path: "Life" })).toEqual({
      id: 9,
      ask: "open",
      path: "Life",
    });
    // An unknown ask still gets an answer, so the widget knows why.
    expect(askRequestOf({ eva: "widget", id: 1, ask: "send" })).toEqual({ id: 1, ask: "send" });
    for (const data of [
      null,
      "hello",
      { eva: "other", id: 1, ask: "hello" },
      { eva: "widget", ask: "hello" },
      { eva: "widget", id: "1", ask: "hello" },
      { eva: "widget", id: Number.NaN, ask: "hello" },
      { eva: "widget", id: 1 },
      // An answer of Eva, as a widget could echo it back, is no request.
      { eva: "widget", id: 1, ok: true },
    ])
      expect(askRequestOf(data)).toBeNull();
  });
});

describe("checkAsk", () => {
  test("hello needs no permission and no tap", () => {
    expect(checkAsk({ id: 1, ask: "hello" }, { approved: [], tapped: false, preview: false })).toBeNull();
  });

  test("an approved ask right after a tap passes", () => {
    expect(checkAsk({ id: 1, ask: "chat", text: "Hi" }, allowed)).toBeNull();
    expect(checkAsk({ id: 1, ask: "open", path: "Life" }, allowed)).toBeNull();
  });

  test("names the reason of each refusal", () => {
    expect(checkAsk({ id: 1, ask: "send" }, allowed)).toBe("unknown");
    expect(checkAsk({ id: 1, ask: "chat", text: "Hi" }, { ...allowed, approved: ["open"] })).toBe("not-allowed");
    expect(checkAsk({ id: 1, ask: "chat", text: "Hi" }, { ...allowed, preview: true })).toBe("not-allowed");
    expect(checkAsk({ id: 1, ask: "open", path: "Life" }, { ...allowed, tapped: false })).toBe("no-tap");
    expect(checkAsk({ id: 1, ask: "chat", text: "x".repeat(askTextLimit + 1) }, allowed)).toBe("too-long");
    expect(checkAsk({ id: 1, ask: "chat", text: "x".repeat(askTextLimit) }, allowed)).toBeNull();
    expect(checkAsk({ id: 1, ask: "chat", text: "  " }, allowed)).toBe("unknown");
    expect(checkAsk({ id: 1, ask: "chat", text: 5 }, allowed)).toBe("unknown");
    expect(checkAsk({ id: 1, ask: "open" }, allowed)).toBe("unknown");
  });

  test("the preview of a clone refuses even hello, so the widget hides what needs Eva", () => {
    expect(checkAsk({ id: 1, ask: "hello" }, { ...allowed, preview: true })).toBe("not-allowed");
  });
});

describe("openAddressOf", () => {
  test("a Life entity opens its page, with or without its main file", () => {
    expect(openAddressOf("Life/Cases/gym-refund")).toBe("#/cases/gym-refund");
    expect(openAddressOf("Life/Cases/gym-refund/Case.md")).toBe("#/cases/gym-refund");
    expect(openAddressOf("Life/People/Alex Example")).toBe("#/people/Alex%20Example");
    expect(openAddressOf("Life/Cases/gym-refund/")).toBe("#/cases/gym-refund");
    expect(openAddressOf("Life/Cases")).toBe("#/cases");
  });

  test("a project opens its page, with or without its AGENTS.md", () => {
    expect(openAddressOf("Projects/2026-11-02-1030-example-app")).toBe("#/projects/2026-11-02-1030-example-app");
    expect(openAddressOf("Projects/2026-11-02-1030-example-app/AGENTS.md")).toBe(
      "#/projects/2026-11-02-1030-example-app",
    );
  });

  test("any other path opens the Files page there", () => {
    expect(openAddressOf("Life/Cases/gym-refund/receipt.pdf")).toBe("#/files/Life/Cases/gym-refund/receipt.pdf");
    expect(openAddressOf("Projects/2026-11-02-1030-example-app/notes/plan.md")).toBe(
      "#/files/Projects/2026-11-02-1030-example-app/notes/plan.md",
    );
    expect(openAddressOf("Projects/not-a-project")).toBe("#/files/Projects/not-a-project");
    expect(openAddressOf("Life/Habits/Read a book")).toBe("#/files/Life/Habits/Read%20a%20book");
  });

  test("refuses a path that a widget never reaches", () => {
    for (const path of [
      "",
      "/Life/Cases",
      "../outside",
      "Life/../../outside",
      ".eva/widgets.json",
      ".git/config",
      "Life/.secret",
      "Life/About me.md",
      "Projects/2026-11-02-1030-example-app/repos/clone-1",
      "C:\\Windows",
      "Life\\Cases",
    ])
      expect(openAddressOf(path)).toBeNull();
  });
});

describe("textAfterTyped", () => {
  test("puts the widget's text after the person's text, in its own paragraph", () => {
    expect(textAfterTyped("", "Hi")).toBe("Hi");
    expect(textAfterTyped("  ", "Hi")).toBe("Hi");
    expect(textAfterTyped("My note \n", "Hi")).toBe("My note\n\nHi");
  });
});
