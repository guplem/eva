import { describe, expect, test } from "bun:test";
import {
  boundedDetail,
  maxDetailLength,
  redactedJsonText,
  toolInputText,
  toolOutputText,
} from "../../../src/shared/tool-details.ts";

describe("toolInputText", () => {
  test("shows the input as indented JSON", () => {
    expect(toolInputText({ file_path: "/demo-vault/Notes.md" })).toBe('{\n  "file_path": "/demo-vault/Notes.md"\n}');
  });

  test("gives no text for a missing input", () => {
    expect(toolInputText(undefined)).toBe("");
  });
});

describe("toolOutputText", () => {
  test("keeps a plain text output", () => {
    expect(toolOutputText("hi\n")).toBe("hi\n");
  });

  test("joins the text parts of a list, and names each image", () => {
    const parts = [
      { type: "text", text: "First" },
      { type: "image", source: { data: "AAAA" } },
      { type: "text", text: "Second" },
    ];
    expect(toolOutputText(parts)).toBe("First\n[image]\nSecond");
  });

  test("shows another value as JSON", () => {
    expect(toolOutputText({ count: 2 })).toBe('{\n  "count": 2\n}');
  });

  test("gives no text for a missing output", () => {
    expect(toolOutputText(undefined)).toBe("");
  });
});

describe("boundedDetail", () => {
  test("keeps a text under the limit whole", () => {
    expect(boundedDetail("short")).toBe("short");
  });

  test("cuts a huge text and says so", () => {
    const cut = boundedDetail("a".repeat(maxDetailLength + 10));
    expect(cut.startsWith("a".repeat(100))).toBe(true);
    expect(cut.endsWith("[Eva cut 10 characters.]")).toBe(true);
  });
});

describe("redactedJsonText", () => {
  const redact = (text: string): string => text.split('a "secret"\nvalue').join("[redacted]");

  test("redacts a secret that JSON escaped, in a value, a key and a list", () => {
    const secret = 'a "secret"\nvalue';
    const text = JSON.stringify({ content: secret, [secret]: 1, list: [secret] }, null, 2);
    expect(JSON.parse(redactedJsonText(text, redact))).toEqual({
      content: "[redacted]",
      "[redacted]": 1,
      list: ["[redacted]"],
    });
  });

  test("redacts a text that is not JSON, or a plain JSON value, as it is", () => {
    expect(redactedJsonText('plain a "secret"\nvalue', redact)).toBe("plain [redacted]");
    expect(redactedJsonText("42", redact)).toBe("42");
  });
});
