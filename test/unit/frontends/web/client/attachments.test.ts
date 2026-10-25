import { describe, expect, test } from "bun:test";
import { messageWithFiles, pastedFiles } from "../../../../../src/frontends/web/client/attachments.ts";

describe("messageWithFiles (issue 409)", () => {
  test("the notes follow the text after a blank line, one note on each line", () => {
    expect(messageWithFiles(" What is this? ", ["[file a]", "[file b]"])).toBe("What is this?\n\n[file a]\n[file b]");
  });

  test("a message with only files is only the notes, and one with no file is only the text", () => {
    expect(messageWithFiles("  ", ["[file a]"])).toBe("[file a]");
    expect(messageWithFiles(" Hello ", [])).toBe("Hello");
  });
});

describe("pastedFiles", () => {
  const screenshot = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });

  test("a pasted image becomes a file to attach", () => {
    expect(pastedFiles({ types: ["Files"], files: [screenshot] })).toEqual([screenshot]);
  });

  test("a paste with text attaches no file, so the text goes into the box", () => {
    expect(pastedFiles({ types: ["text/plain", "Files"], files: [screenshot] })).toEqual([]);
    expect(pastedFiles({ types: ["text/plain"], files: [] })).toEqual([]);
  });
});
