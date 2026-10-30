import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instructionPart, shownPath, skillParts } from "../../../src/shared/context-files.ts";

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-context-files-"));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("shownPath", () => {
  test("shows a path inside the start folder from the start folder", () => {
    expect(shownPath(join(folder, "docs", "AGENTS.md"), folder)).toBe(join("docs", "AGENTS.md"));
  });

  test("shows a path outside the start folder whole", () => {
    const outside = join(tmpdir(), "AGENTS.md");
    expect(shownPath(outside, folder)).toBe(outside);
  });
});

describe("instructionPart", () => {
  test("gives the whole text of a file", () => {
    writeFileSync(join(folder, "AGENTS.md"), "# Rules\n\nBe brief.\n");
    expect(instructionPart(join(folder, "AGENTS.md"), folder)).toEqual({
      group: "instructions",
      title: "AGENTS.md",
      source: join(folder, "AGENTS.md"),
      text: "# Rules\n\nBe brief.\n",
      note: null,
    });
  });

  test("skips a missing or empty file", () => {
    writeFileSync(join(folder, "CLAUDE.md"), "  \n");
    expect(instructionPart(join(folder, "CLAUDE.md"), folder)).toBeNull();
    expect(instructionPart(join(folder, "AGENTS.md"), folder)).toBeNull();
  });
});

describe("skillParts", () => {
  test("lists each skill folder with a SKILL.md, by name", () => {
    for (const name of ["write-note", "daily-plan", "no-skill-file"]) mkdirSync(join(folder, name));
    writeFileSync(join(folder, "write-note", "SKILL.md"), "Write a note.");
    writeFileSync(join(folder, "daily-plan", "SKILL.md"), "Plan the day.");
    writeFileSync(join(folder, "README.md"), "Not a skill.");
    expect(skillParts(folder).map((part) => [part.group, part.title, part.text])).toEqual([
      ["skills", "daily-plan", "Plan the day."],
      ["skills", "write-note", "Write a note."],
    ]);
  });

  test("gives no skill for a missing folder", () => {
    expect(skillParts(join(folder, "missing"))).toEqual([]);
  });
});
