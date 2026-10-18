/**
 * Copies the skills from `.agents/skills/` to `.claude/skills/`, the only folder where Claude Code
 * finds skills. `.agents/skills/` is the one home of each skill; git ignores the copy.
 * The git hooks run this script after a checkout or a merge, and `bun install` runs it once.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export function syncSkills(root: string): void {
  const source = join(root, ".agents", "skills");
  const copy = join(root, ".claude", "skills");
  if (!existsSync(source)) return;
  // The copy holds only generated files, so a full replace also drops a deleted skill.
  rmSync(copy, { recursive: true, force: true });
  cpSync(source, copy, { recursive: true });
}

if (import.meta.main) syncSkills(process.cwd());
