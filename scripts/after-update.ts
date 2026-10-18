/**
 * The setup after a pull or a branch switch: install the dependencies when `bun.lock` changed,
 * then copy the skills for Claude Code. The post-merge and post-checkout git hooks run it.
 * Usage: `bun run scripts/after-update.ts <from> <to>`.
 */
import { syncSkills } from "./sync-skills.ts";

export interface AfterUpdateSteps {
  /** The paths that changed between two commits, or null when git cannot tell. */
  readonly changedPaths: (from: string, to: string) => readonly string[] | null;
  readonly install: () => void;
  readonly syncSkills: () => void;
}

// A new worktree or clone gives an all-zero commit as `from`.
const noCommit = /^0+$/;

export function afterUpdate(from: string | undefined, to: string | undefined, steps: AfterUpdateSteps): void {
  const known = from !== undefined && to !== undefined && !noCommit.test(from);
  const changed = known ? steps.changedPaths(from, to) : null;
  // Unknown changes install too: a new worktree has no dependencies yet.
  if (changed === null || changed.includes("bun.lock")) steps.install();
  steps.syncSkills();
}

function changedPaths(from: string, to: string): readonly string[] | null {
  const result = Bun.spawnSync(["git", "diff", "--name-only", from, to], { stdout: "pipe", stderr: "ignore" });
  if (result.exitCode !== 0) return null;
  return result.stdout
    .toString()
    .split("\n")
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
}

if (import.meta.main) {
  const [from, to] = process.argv.slice(2);
  afterUpdate(from, to, {
    changedPaths,
    install: () => {
      // The lockfile comes from git, so the install must not rewrite it.
      Bun.spawnSync(["bun", "install", "--frozen-lockfile"], { stdout: "inherit", stderr: "inherit" });
    },
    syncSkills: () => syncSkills(process.cwd()),
  });
}
