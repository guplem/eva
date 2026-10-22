import { describe, expect, test } from "bun:test";
import {
  chatTitles,
  modeWaitsForRestart,
  rulesPlaceWords,
  rulesStateWords,
} from "../../../../../src/frontends/web/client/permission-words.ts";
import type { PersonPermissionRules } from "../../../../../src/shared/permissions.ts";

const rules = (overrides: Partial<PersonPermissionRules>): PersonPermissionRules => ({
  place: "vault",
  file: ".claude/settings.json",
  state: "ok",
  allow: [],
  ask: [],
  deny: [],
  ...overrides,
});

describe("permission words", () => {
  test("names each kind of chat and each place of the person's rules", () => {
    expect(chatTitles["untrusted-project"]).toContain("does not trust");
    expect(rulesPlaceWords("machine")).toContain("every Claude Code chat");
    expect(rulesPlaceWords("vault")).toContain("Assistant chats");
  });

  test("says why a rules file shows no rules, and nothing when it has some", () => {
    expect(rulesStateWords(rules({ state: "missing" }))).toContain("does not exist");
    expect(rulesStateWords(rules({ state: "invalid" }))).toContain("JSON");
    expect(rulesStateWords(rules({}))).toContain("no permission rules");
    expect(rulesStateWords(rules({ deny: ["Read(./.env)"] }))).toBeNull();
  });

  test("a chosen mode that the running engine does not use yet waits for a restart", () => {
    expect(modeWaitsForRestart("Auto", "Bypass permissions")).toBe(true);
    expect(modeWaitsForRestart("Auto", "Auto")).toBe(false);
    expect(modeWaitsForRestart(null, "Auto")).toBe(false);
  });
});
