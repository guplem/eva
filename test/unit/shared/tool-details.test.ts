import { describe, expect, test } from "bun:test";
import { boundedDetail, maxDetailLength, toolInputText, toolOutputText } from "../../../src/shared/tool-details.ts";

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
