import { describe, expect, test } from "bun:test";
import { mergeMessage, partStateWords, updatedWords } from "../../../../../src/frontends/web/client/template-words.ts";

describe("partStateWords", () => {
  test("marks only a new version as a warning", () => {
    expect(partStateWords("differs")).toEqual({ label: "New version", tone: "warn" });
    expect(partStateWords("current").tone).toBe("ok");
    for (const state of ["pending", "yours", "kept", "missing"] as const)
      expect(partStateWords(state).tone).toBe("idle");
  });
});

describe("mergeMessage", () => {
  test("names the file and carries Eva's new version", () => {
    const message = mergeMessage({
      path: ".eva/skills/schedule/SKILL.md",
      kind: "skill",
      name: "schedule",
      state: "differs",
      updatedAt: null,
      newText: "# Schedule\n\nNew.\n",
    });
    expect(message).toContain("`.eva/skills/schedule/SKILL.md`");
    expect(message).toContain("keep my changes");
    expect(message).toContain("````markdown\n# Schedule\n\nNew.\n````");
  });
});

describe("updatedWords", () => {
  test("gives the date of the last update, or nothing", () => {
    expect(updatedWords("2026-10-22T08:00:00.000Z", "en-GB")).toBe("Updated on 22 Oct 2026");
    expect(updatedWords(null)).toBeNull();
    expect(updatedWords("not a date")).toBeNull();
  });
});
