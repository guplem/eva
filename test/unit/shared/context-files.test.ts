import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instructionPart, instructionPartsIn, shownPath, skillParts } from "../../../src/shared/context-files.ts";

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

describe("skillParts and links", () => {
  test("follows a link to a skill folder, as the engines do", () => {
    const target = join(folder, "elsewhere", "linked-skill");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "SKILL.md"), "A linked skill.");
    mkdirSync(join(folder, "skills"));
    symlinkSync(target, join(folder, "skills", "linked-skill"), "junction");
    expect(skillParts(join(folder, "skills")).map((part) => part.text)).toEqual(["A linked skill."]);
  });
});

describe("instructionPartsIn", () => {
  test("lists each Markdown file of a folder and its subfolders, and none for a missing folder", () => {
    mkdirSync(join(folder, "rules", "deep"), { recursive: true });
    writeFileSync(join(folder, "rules", "a.md"), "A.");
    writeFileSync(join(folder, "rules", "deep", "b.md"), "B.");
    writeFileSync(join(folder, "rules", "c.txt"), "C.");
    expect(instructionPartsIn(join(folder, "rules"), folder).map((part) => part.title)).toEqual([
      join("rules", "a.md"),
      join("rules", "deep", "b.md"),
    ]);
    expect(instructionPartsIn(join(folder, "missing"), folder)).toEqual([]);
  });
});

describe("instructionPartsIn and links", () => {
  test("reads each real folder once, so a link back to a folder above cannot loop", () => {
    mkdirSync(join(folder, "rules"));
    writeFileSync(join(folder, "rules", "a.md"), "A.");
    symlinkSync(join(folder, "rules"), join(folder, "rules", "loop"), "junction");
    symlinkSync(join(folder, "rules"), join(folder, "rules", "again"), "junction");
    expect(instructionPartsIn(join(folder, "rules"), folder).map((part) => part.text)).toEqual(["A."]);
  });
});
