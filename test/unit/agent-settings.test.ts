/**
 * Tests for the agent permission rules in `.claude/settings.json` (#89).
 * The file has no `src/` twin: it is read by Claude Code, not by Eva.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface Permissions {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
  readonly ask?: readonly string[];
}

const settingsPath = fileURLToPath(new URL("../../.claude/settings.json", import.meta.url));
const permissions = (JSON.parse(readFileSync(settingsPath, "utf8")) as { permissions: Permissions }).permissions;

/** Claude Code's wildcard rule: `*` matches any text, and a trailing ` *` also matches the bare command. */
function matches(rule: string, command: string): boolean {
  const inner = /^Bash\((.*)\)$/.exec(rule)?.[1];
  if (inner === undefined) return false;
  const escaped = inner.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  const pattern = escaped.endsWith(" .*") ? `${escaped.slice(0, -3)}( .*)?` : escaped;
  return new RegExp(`^${pattern}$`, "s").test(command);
}

const allowed = (command: string): boolean => permissions.allow.some((rule) => matches(rule, command));
const denied = (command: string): boolean => permissions.deny.some((rule) => matches(rule, command));

describe("agent permission rules", () => {
  test("no ask rule: the owner allows push, merge and the GitHub write tools (#89)", () => {
    expect(permissions.ask ?? []).toEqual([]);
  });

  test.each([
    "git push -u origin claude/issue-89",
    "git push -q",
    "git push",
    "git commit -q -m subject",
    "git commit -q -F -",
    "git add -A",
    "git fetch origin main",
    "git merge origin/main",
    "git checkout -b claude/issue-89",
    "git restore --staged src/main.ts",
    "git rm src/old.ts",
    "bunx playwright test -c pw.config.ts -g login",
    "npx tsc --noEmit",
    "rm -rf test-results",
  ])("allows %p", (command) => {
    expect(allowed(command)).toBe(true);
    expect(denied(command)).toBe(false);
  });

  test.each([
    "git push --force origin main",
    "git push -f origin main",
    "git push -fu origin main",
    "git push origin main --force-with-lease",
    "git push origin +main",
    "git push origin --delete main",
    "git push origin :main",
    "git push --no-verify origin main",
    "git commit --amend --no-edit",
    "git commit -q --no-verify -m subject",
    "git reset --hard origin/main",
    "git rebase main",
    "git clean -fdx",
    "git checkout -- src/main.ts",
    "git checkout -B main",
    "git restore --staged --worktree src/main.ts",
    "git rm -f src/main.ts",
    "git stash drop",
    "gh pr merge 99 --admin",
    "git push origin main -qf",
    "git push -q origin main -vf",
    "git push origin -qd main",
    "git push --receive-pack=x origin main",
    "git rm -rf src",
    "git rm -q -fr src",
    "git add -Af .env",
    "git restore --staged -SW src/main.ts",
    "git fetch --upload-pack=x .",
    "git fetch -f origin main:main",
    "git fetch origin +main:main",
  ])("denies %p", (command) => {
    expect(denied(command)).toBe(true);
  });

  test.each([
    "git push ../vault main",
    "git push https://github.com/example/vault main",
    "git checkout src/main.ts",
    "git restore src/main.ts",
    "rm -rf /tmp/claude-0/a src /tmp/claude-0/b/test-results",
    "python3 -",
    "pkill bun",
    "find . -delete",
    "sort -o src/main.ts /dev/null",
    "uniq a.txt src/main.ts",
    "sed -n '1e cat .env' README.md",
    "sed -i s/a/b/ ../vault/note.md",
    "cp .env /tmp/claude-0/x",
    "mv src /tmp/claude-0/x",
  ])("leaves %p to a prompt", (command) => {
    expect(allowed(command)).toBe(false);
  });

  test.each([
    "Read(//**/.env)",
    "Read(//**/.env.*)",
    "Read(//**/secrets.json)",
    "Read(~/.ssh/**)",
    "Read(//**/.credentials.json)",
    "Read(//**/auth.json)",
    "Read(//**/gh/hosts.yml)",
    "Read(//**/engines/google/**)",
    "mcp__github__push_files",
    "mcp__github__create_or_update_file",
    "mcp__github__delete_file",
  ])("denies %p", (rule) => {
    expect(permissions.deny).toContain(rule);
  });

  test("allows no tool or server as a whole", () => {
    const banned = [
      "Bash",
      "Bash(*)",
      "Bash(git *)",
      "Bash(git push *)",
      "mcp__github__*",
      "mcp__claude-code-remote__*",
    ];
    expect(permissions.allow.filter((rule) => banned.includes(rule))).toEqual([]);
  });

  test("names no MCP rule with parentheses, which Claude Code skips", () => {
    expect([...permissions.allow, ...permissions.deny].filter((rule) => /^mcp__.*\(/.test(rule))).toEqual([]);
  });
});
