/**
 * Tests for the setup that the git hooks run after a pull or a branch switch.
 * The file has no `src/` twin: it tests `scripts/after-update.ts`, which only the git hooks run.
 */
import { describe, expect, test } from "bun:test";
import { afterUpdate } from "../../scripts/after-update.ts";

function steps(changed: readonly string[] | null): { log: string[]; run: (from?: string, to?: string) => void } {
  const log: string[] = [];
  return {
    log,
    run: (from, to) =>
      afterUpdate(from, to, {
        changedPaths: (first, second) => {
          log.push(`diff ${first} ${second}`);
          return changed;
        },
        install: () => log.push("install"),
        syncSkills: () => log.push("skills"),
      }),
  };
}

describe("afterUpdate", () => {
  test("installs when bun.lock changed, and always copies the skills", () => {
    const changed = steps(["src/main.ts", "bun.lock"]);
    changed.run("aaa", "bbb");
    expect(changed.log).toEqual(["diff aaa bbb", "install", "skills"]);
    const unchanged = steps(["src/main.ts"]);
    unchanged.run("aaa", "bbb");
    expect(unchanged.log).toEqual(["diff aaa bbb", "skills"]);
  });

  test("a new worktree, with an all-zero commit, installs without a diff", () => {
    const created = steps([]);
    created.run("0000000000000000000000000000000000000000", "bbb");
    expect(created.log).toEqual(["install", "skills"]);
  });

  test("a diff that git cannot make, or missing arguments, installs to be safe", () => {
    const failed = steps(null);
    failed.run("aaa", "bbb");
    expect(failed.log).toEqual(["diff aaa bbb", "install", "skills"]);
    const bare = steps([]);
    bare.run();
    expect(bare.log).toEqual(["install", "skills"]);
  });
});
