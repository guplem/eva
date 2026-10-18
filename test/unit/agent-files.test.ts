/**
 * Tests for the agent instruction files of this repository. CI runs them, because a cloud
 * agent commits with no git hooks, so the `no-claude-md` hook in `lefthook.yml` never sees its commits.
 */
import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

function trackedFiles(): string[] {
  const result = Bun.spawnSync(["git", "ls-files"], { cwd: root });
  return result.stdout
    .toString()
    .split("\n")
    .filter((path) => path !== "");
}

describe("agent instruction files", () => {
  test("no CLAUDE.md exists, because one hides every AGENTS.md from Claude Code", () => {
    expect(trackedFiles().filter((path) => path === "CLAUDE.md" || path.endsWith("/CLAUDE.md"))).toEqual([]);
  });
});
