import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { carryClaudeHistory, claudeProjectFolder } from "../../../../src/engines/claude-code/claude-code-history.ts";

let root: string;
let config: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eva-claude-history-"));
  config = join(root, "config");
  mkdirSync(join(config, "projects"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * A contract test: Claude Code keeps a chat in `<config>/projects/<folder name>/<id>.jsonl`, and the
 * folder name is the start folder with each character that is no letter or digit made a `-`. This
 * is no public format, so a change in Claude Code must fail here. Seen with Claude Code 2: a chat
 * started in `/srv/eva` lives in `projects/-srv-eva/`.
 */
describe("claudeProjectFolder", () => {
  test("turns each character that is no letter or digit into a dash", () => {
    expect(claudeProjectFolder("/srv/eva")).toBe("-srv-eva");
    expect(claudeProjectFolder("/vault/Projects/2026-10-24-1015-example-app/repos/clone-1")).toBe(
      "-vault-Projects-2026-10-24-1015-example-app-repos-clone-1",
    );
    expect(claudeProjectFolder("D:\\vault\\clone_1")).toBe("D--vault-clone-1");
  });

  test("gives null for a name that Claude Code shortens with a hash", () => {
    expect(claudeProjectFolder(`/${"a".repeat(200)}`)).toBeNull();
  });
});

describe("carryClaudeHistory", () => {
  function chat(folderName: string, id: string, text: string): string {
    const folder = join(config, "projects", folderName);
    mkdirSync(folder, { recursive: true });
    const path = join(folder, `${id}.jsonl`);
    writeFileSync(path, text);
    return path;
  }

  test("copies the chat to the folder of the new start folder", () => {
    chat("-clones-clone-0", "abc-1", '{"type":"user"}\n');
    const toFolder = join(root, "clone-1");
    mkdirSync(toFolder);
    expect(carryClaudeHistory({ engineSessionId: "abc-1", toFolder, environment: { CLAUDE_CONFIG_DIR: config } })).toBe(
      true,
    );
    const copied = join(config, "projects", claudeProjectFolder(toFolder) ?? "", "abc-1.jsonl");
    expect(readFileSync(copied, "utf8")).toBe('{"type":"user"}\n');
  });

  test("takes the newest copy when two folders hold the chat", () => {
    const old = chat("-old", "abc-2", "old\n");
    chat("-new", "abc-2", "new\n");
    utimesSync(old, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    const toFolder = join(root, "clone-2");
    expect(carryClaudeHistory({ engineSessionId: "abc-2", toFolder, environment: { CLAUDE_CONFIG_DIR: config } })).toBe(
      true,
    );
    expect(readFileSync(join(config, "projects", claudeProjectFolder(toFolder) ?? "", "abc-2.jsonl"), "utf8")).toBe(
      "new\n",
    );
  });

  test("gives false when no folder holds the chat, or the id is not safe", () => {
    const toFolder = join(root, "clone-3");
    const environment = { CLAUDE_CONFIG_DIR: config };
    expect(carryClaudeHistory({ engineSessionId: "missing", toFolder, environment })).toBe(false);
    expect(carryClaudeHistory({ engineSessionId: "../escape", toFolder, environment })).toBe(false);
    expect(carryClaudeHistory({ engineSessionId: "x", toFolder: `/${"a".repeat(200)}`, environment })).toBe(false);
    expect(existsSync(join(config, "projects", claudeProjectFolder(toFolder) ?? ""))).toBe(false);
  });

  test("gives false when the config folder has no chats at all", () => {
    expect(
      carryClaudeHistory({
        engineSessionId: "abc",
        toFolder: join(root, "clone-4"),
        environment: { CLAUDE_CONFIG_DIR: join(root, "nothing") },
      }),
    ).toBe(false);
  });
});
