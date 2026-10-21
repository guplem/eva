import { describe, expect, test } from "bun:test";
import { mergeMessage, partStateWords } from "../../../../../src/frontends/web/client/template-words.ts";

describe("partStateWords", () => {
  test("marks only a new version as a warning", () => {
    expect(partStateWords("differs")).toEqual({ label: "New version", tone: "warn" });
    expect(partStateWords("current").tone).toBe("ok");
    for (const state of ["yours", "kept", "missing"] as const) expect(partStateWords(state).tone).toBe("idle");
  });
});

describe("mergeMessage", () => {
  test("names the file and carries Eva's new version", () => {
    const message = mergeMessage({
      path: ".eva/skills/schedule/SKILL.md",
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
