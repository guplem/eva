import { describe, expect, test } from "bun:test";
import { mentionsIn, mentionToken } from "../../../src/shared/mentions.ts";

describe("mentionToken", () => {
  test("quotes a name with a space or with punctuation at its end", () => {
    expect(mentionToken("file", "Notes/Plan.md")).toBe("@file:Notes/Plan.md");
    expect(mentionToken("file", "Notes/My plan.md")).toBe('@file:"Notes/My plan.md"');
    expect(mentionToken("project", "example-app.")).toBe('@project:"example-app."');
  });
});

describe("mentionsIn", () => {
  test("finds each mention in order, with its kind, name and place", () => {
    const text = 'See @file:Notes/Plan.md and @file:"Notes/My plan.md", then @project:example-app.';
    expect(mentionsIn(text)).toEqual([
      { kind: "file", name: "Notes/Plan.md", token: "@file:Notes/Plan.md", start: 4 },
      { kind: "file", name: "Notes/My plan.md", token: '@file:"Notes/My plan.md"', start: 28 },
      { kind: "project", name: "example-app", token: "@project:example-app", start: 59 },
    ]);
  });

  test("ignores an email address and a mention inside a word", () => {
    expect(mentionsIn("Write to person@file:example.com today")).toEqual([]);
  });

  test("gives the same answer when called twice, so no state stays between calls", () => {
    const text = "@file:a.md";
    expect(mentionsIn(text)).toEqual(mentionsIn(text));
  });
});
