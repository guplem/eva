import { describe, expect, test } from "bun:test";
import { assistantBasePrompt } from "../../../../src/core/modes/assistant-base-prompt.ts";
import { defaultAssistantRules } from "../../../../src/core/vault/vault-template.ts";
import { evaRepository } from "../../../../src/shared/version.ts";

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

  test("offers to open a detailed issue in Eva's own repository when the person reports a problem with Eva", () => {
    expect(assistantBasePrompt).toContain("## Problems with Eva herself");
    expect(assistantBasePrompt).toContain(`gh issue create --repo ${evaRepository}`);
    expect(assistantBasePrompt).toContain("Done when");
    expect(assistantBasePrompt).not.toContain("{{");
  });

  test("puts the device facts in an issue, and scrubs the personal data out of its log lines", () => {
    for (const fact of ["screen size", "phone, tablet or computer", "through Tailscale", "operating system"]) {
      expect(assistantBasePrompt).toContain(fact);
    }
    for (const placeholder of ["`<vault>`", "`<home>`", "`<machine>`", "`<person>`"]) {
      expect(assistantBasePrompt).toContain(placeholder);
    }
    expect(assistantBasePrompt).toContain("Report a bug");
  });

  test("installs missing programs without administrator rights: a service has no terminal for a sudo password", () => {
    expect(assistantBasePrompt).toContain("## Installing programs");
    expect(assistantBasePrompt).toContain("sudo");
    expect(assistantBasePrompt).toContain("uv run --with");
  });

  test("names no person: the person's rules come from their vault", () => {
    expect(assistantBasePrompt).not.toMatch(/\b(he|she|his|her)\b/i);
  });
});
