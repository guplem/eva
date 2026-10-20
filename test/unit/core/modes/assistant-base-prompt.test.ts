import { describe, expect, test } from "bun:test";
import { assistantBasePrompt } from "../../../../src/core/modes/assistant-base-prompt.ts";
import { defaultAssistantRules } from "../../../../src/core/vault/vault-template.ts";

describe("assistantBasePrompt", () => {
  test("holds the rules every person needs", () => {
    expect(assistantBasePrompt).toStartWith("# You are Eva");
    for (const section of [
      "## Acting in the world",
      "## Projects",
      "## Your own state",
      "## Your files in the vault",
      "## Sending files",
    ]) {
      expect(assistantBasePrompt).toContain(section);
    }
  });

  test("leaves the personality to the person's rules, which can change it", () => {
    for (const section of ["## Answering from the notes", "## Learning", "## Style"]) {
      expect(assistantBasePrompt).not.toContain(section);
      expect(defaultAssistantRules).toContain(section);
    }
    expect(assistantBasePrompt).toContain("the person's rules win");
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
