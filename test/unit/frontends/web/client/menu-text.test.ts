import { describe, expect, test } from "bun:test";
import { composerMenuItems, insertedText } from "../../../../../src/frontends/web/client/menu-text.ts";

describe("insertedText (#661)", () => {
  test("puts the text at the cursor and keeps the typed text around it", () => {
    expect(insertedText("Hello world", { start: 6, end: 6 }, "big ")).toEqual({
      text: "Hello big world",
      cursor: 10,
    });
  });

  test("puts the text in place of a selection", () => {
    expect(insertedText("Hello world", { start: 6, end: 11 }, "Eva")).toEqual({ text: "Hello Eva", cursor: 9 });
  });

  test("fills an empty box", () => {
    expect(insertedText("", { start: 0, end: 0 }, "Summary")).toEqual({ text: "Summary", cursor: 7 });
  });

  test("a cursor past the end goes at the end", () => {
    expect(insertedText("Hi", { start: 9, end: 9 }, "!")).toEqual({ text: "Hi!", cursor: 3 });
  });
});

describe("composerMenuItems (#661)", () => {
  const items = {
    textActions: [{ name: "Polish", model: "haiku" as const, prompt: "Fix it." }],
    savedPrompts: [{ name: "Summary", text: "Sum it up." }],
  };

  test("groups the text actions, then the saved prompts", () => {
    const chosen: string[] = [];
    const menu = composerMenuItems(items, {
      canRewrite: true,
      onAction: (name) => chosen.push(`action ${name}`),
      onPrompt: (text) => chosen.push(`prompt ${text}`),
    });
    expect(menu.map((item) => [item.group, item.label])).toEqual([
      ["Text actions", "Polish"],
      ["Saved prompts", "Summary"],
    ]);
    for (const item of menu) item.onChoose();
    expect(chosen).toEqual(["action Polish", "prompt Sum it up."]);
  });

  test("only the headings have an icon: a wand for the text actions, a clipboard for the saved prompts (#672)", () => {
    const menu = composerMenuItems(items, { canRewrite: true, onAction: () => undefined, onPrompt: () => undefined });
    expect(menu.map((item) => [item.groupIcon, item.icon])).toEqual([
      ["wand", undefined],
      ["clipboard", undefined],
    ]);
  });

  test("an empty box shows each text action, but turned off: there is nothing to rewrite", () => {
    const menu = composerMenuItems(items, { canRewrite: false, onAction: () => undefined, onPrompt: () => undefined });
    expect(menu.map((item) => [item.label, item.disabled === true])).toEqual([
      ["Polish", true],
      ["Summary", false],
    ]);
  });
});
