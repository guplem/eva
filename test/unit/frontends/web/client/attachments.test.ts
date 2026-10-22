import { describe, expect, test } from "bun:test";
import { messageWithFiles } from "../../../../../src/frontends/web/client/attachments.ts";

describe("messageWithFiles (issue 409)", () => {
  test("the notes follow the text after a blank line, one note on each line", () => {
    expect(messageWithFiles(" What is this? ", ["[file a]", "[file b]"])).toBe("What is this?\n\n[file a]\n[file b]");
  });

  test("a message with only files is only the notes, and one with no file is only the text", () => {
    expect(messageWithFiles("  ", ["[file a]"])).toBe("[file a]");
    expect(messageWithFiles(" Hello ", [])).toBe("Hello");
  });
});
