import { describe, expect, test } from "bun:test";
import { assistantBasePrompt } from "../../../../src/core/modes/assistant-base-prompt.ts";

describe("assistantBasePrompt", () => {
  test("holds the rules every person needs (plan §5.2)", () => {
    expect(assistantBasePrompt).toStartWith("# You are Eva");
    for (const section of [
      "## Answering from the notes",
      "## Learning",
      "## Acting in the world",
      "## Projects",
      "## Sending files",
    ]) {
      expect(assistantBasePrompt).toContain(section);
    }
  });

  test("names no person: the person's rules come from their vault", () => {
    expect(assistantBasePrompt).not.toMatch(/\b(he|she|his|her)\b/i);
  });
});
