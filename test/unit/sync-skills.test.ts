/**
 * Tests for the skill copy that the git hooks run.
 * The file has no `src/` twin: it tests `scripts/sync-skills.ts`, which only the git hooks run.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncSkills } from "../../scripts/sync-skills.ts";

const roots: string[] = [];

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "eva-skills-"));
  roots.push(root);
  return root;
}

function write(root: string, path: string, text: string): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("syncSkills", () => {
  test("copies each skill with its files to .claude/skills", () => {
    const root = repository();
    write(root, ".agents/skills/write-commit/SKILL.md", "commit");
    write(root, ".agents/skills/rename-symbol/notes/cases.md", "cases");
    syncSkills(root);
    expect(readFileSync(join(root, ".claude/skills/write-commit/SKILL.md"), "utf8")).toBe("commit");
    expect(readFileSync(join(root, ".claude/skills/rename-symbol/notes/cases.md"), "utf8")).toBe("cases");
  });

  test("replaces a changed skill and removes a deleted one", () => {
    const root = repository();
    write(root, ".agents/skills/write-commit/SKILL.md", "new");
    write(root, ".claude/skills/write-commit/SKILL.md", "old");
    write(root, ".claude/skills/write-commit/stale.md", "stale");
    write(root, ".claude/skills/gone/SKILL.md", "gone");
    syncSkills(root);
    expect(readFileSync(join(root, ".claude/skills/write-commit/SKILL.md"), "utf8")).toBe("new");
    expect(existsSync(join(root, ".claude/skills/write-commit/stale.md"))).toBe(false);
    expect(existsSync(join(root, ".claude/skills/gone"))).toBe(false);
  });

  test("keeps the rest of .claude and does nothing without .agents/skills", () => {
    const root = repository();
    write(root, ".claude/settings.json", "{}");
    syncSkills(root);
    expect(readFileSync(join(root, ".claude/settings.json"), "utf8")).toBe("{}");
    expect(existsSync(join(root, ".claude/skills"))).toBe(false);
  });
});
