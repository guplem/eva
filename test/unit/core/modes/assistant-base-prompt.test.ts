import { describe, expect, test } from "bun:test";
import { assistantBasePrompt } from "../../../../src/core/modes/assistant-base-prompt.ts";

describe("assistantBasePrompt", () => {
  test("holds the rules every person needs", () => {
    expect(assistantBasePrompt).toStartWith("# You are Eva");
    for (const section of [
      "## Answering from the notes",
      "## Learning",
      "## Acting in the world",
      "## Projects",
      "## Sending files",
      "## Your own state",
    ]) {
      expect(assistantBasePrompt).toContain(section);
    }
  });

  test("sends a Google login to Settings: the login link of the Google tools opens only on Eva's computer", () => {
    expect(assistantBasePrompt).toContain("Start the Google login");
  });

  test("says where the rules for chat names go, so the person can change them in a chat (issue 50)", () => {
    expect(assistantBasePrompt).toContain("`.eva/chat-names.md`");
  });

  test("names no person: the person's rules come from their vault", () => {
    expect(assistantBasePrompt).not.toMatch(/\b(he|she|his|her)\b/i);
  });
});
