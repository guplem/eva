import { describe, expect, test } from "bun:test";
import { assistantBasePrompt } from "../../../../src/core/modes/assistant-base-prompt.ts";
import { projectStatuses } from "../../../../src/shared/project-statuses.ts";
import { projectTypes } from "../../../../src/shared/project-types.ts";
import { defaultAssistantRules } from "../../../../src/core/vault/vault-template.ts";
import { evaRepository } from "../../../../src/shared/version.ts";
import { evaCoreSkillNames } from "../../../../src/core/modes/eva-core.ts";

describe("assistantBasePrompt", () => {
  test("holds the rules every person needs", () => {
    expect(assistantBasePrompt).toStartWith("# You are Eva");
    for (const section of [
      "## Acting in the world",
      "## Projects",
      "## Your own state",
      "## Your files in the vault",
      "## Sending files",
      "## Answering from the notes",
      "## Learning",
      "## Limits",
      "## Pinned files",
      "## Format settings",
      "## Eva's skills",
    ]) {
      expect(assistantBasePrompt).toContain(section);
    }
  });

  test("asks for each vault path from the vault root, so the web app links it to the right file (#821)", () => {
    expect(assistantBasePrompt).toContain("full path from the vault root");
  });

  test("leaves the tone and how proactive Eva is to the person's rules, which can change them (#771)", () => {
    for (const section of ["## Style", "## Behaviour"]) {
      expect(assistantBasePrompt).not.toContain(section);
      expect(defaultAssistantRules).toContain(section);
    }
    expect(assistantBasePrompt).toContain("the person's rules win");
  });

  test("names each project status, so the agent of an older vault learns in-use (#690)", () => {
    for (const status of projectStatuses) expect(assistantBasePrompt).toContain(`\`${status}\``);
    expect(assistantBasePrompt).toContain("The `active` and `in-use` projects are in the pinned block");
  });

  test("names the words that the pinned block prints, so the block and the prompt stay aligned (#769)", () => {
    for (const word of [
      "`pinned: full`",
      "`pinned: summary`",
      "`pinned: false`",
      "`DUE`",
      "`DEADLINE`",
      "N more not shown",
    ])
      expect(assistantBasePrompt).toContain(word);
    expect(assistantBasePrompt).toContain(
      "**A case line marked `DUE`** has a `next` date that has come. **A `DEADLINE` mark** means its deadline is 14 days away or less, or has passed. Tell the person once in the chat, when it fits.",
    );
  });

  test("names each project type, and the default by repos, so the agent never writes a wrong type (#768)", () => {
    for (const type of projectTypes)
      expect(assistantBasePrompt).toContain(`**${type.charAt(0).toUpperCase()}${type.slice(1)}:**`);
    expect(assistantBasePrompt).toContain("No type means `general`, or `software` when the project lists `repos`.");
  });

  test("sends a Google login to Settings: the login link of the Google tools opens only on Eva's computer", () => {
    expect(assistantBasePrompt).toContain("Start the Google login");
  });

  test("says where the rules for chat names go, so the person can change them in a chat (issue 50)", () => {
    expect(assistantBasePrompt).toContain("`.eva/settings/chat-names.md`");
  });

  test("sends a question about how Eva works to her docs (#832)", () => {
    expect(assistantBasePrompt).toContain(`https://github.com/${evaRepository}/tree/main/docs/guide`);
    expect(assistantBasePrompt).toContain("how-eva-works.md");
  });

  test("offers the eva-issue skill when the person reports a problem with Eva, and leaves the procedure to it (#771)", () => {
    expect(assistantBasePrompt).toContain("## Problems with Eva herself");
    expect(assistantBasePrompt).toContain(`https://github.com/${evaRepository}`);
    expect(assistantBasePrompt).toContain("offer to report it with the `eva-issue` skill");
    expect(assistantBasePrompt).not.toContain("gh issue create");
    expect(assistantBasePrompt).not.toContain("{{");
  });

  test("lists each of Eva's own skills, so the agent knows that they ship with Eva (#771)", () => {
    for (const name of evaCoreSkillNames) expect(assistantBasePrompt).toContain(`- \`${name}\`:`);
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
