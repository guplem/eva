import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeCodeEngine } from "../../../../src/engines/claude-code/claude-code-adapter.ts";
import { describeClaudePermissions } from "../../../../src/engines/claude-code/claude-code-permissions.ts";
import { askedActionWords } from "../../../../src/shared/outward-actions.ts";
import type { ChatPermissions, EnginePermissions } from "../../../../src/shared/permissions.ts";

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-claude-permissions-"));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function chat(permissions: EnginePermissions, kind: ChatPermissions["chat"]): ChatPermissions {
  const found = permissions.chats.find((entry) => entry.chat === kind);
  if (found === undefined) throw new Error(`No ${kind} chat.`);
  return found;
}

const noRules = { vaultFolder: null, environment: {} };

describe("describeClaudePermissions", () => {
  test("in auto mode, an Assistant chat asks before each action that reaches other people", () => {
    const permissions = describeClaudePermissions("auto", noRules);
    expect(permissions.mode).toEqual({ value: "auto", words: "Auto" });
    expect(chat(permissions, "assistant").asks).toEqual(askedActionWords);
    expect(chat(permissions, "assistant").blocks.join(" ")).toContain("safety check");
    expect(chat(permissions, "assistant").runs.join(" ")).toContain(".eva/");
    // The patterns need an explicit method, so the words name it.
    expect(chat(permissions, "assistant").asks.join(" ")).toContain("curl -X");
    // Issue #440: a schedule runs a turn later on its own, so a change to one asks first.
    expect(chat(permissions, "assistant").asks.join(" ")).toContain("schedules.json");
  });

  test("in bypass mode, a trusted chat asks nothing, and an untrusted clone still uses auto", () => {
    const permissions = describeClaudePermissions("bypassPermissions", noRules);
    expect(permissions.mode?.value).toBe("bypassPermissions");
    expect(chat(permissions, "assistant").asks).toEqual([]);
    expect(chat(permissions, "trusted-project").asks).toEqual([]);
    expect(chat(permissions, "untrusted-project").asks).not.toEqual([]);
    expect(chat(permissions, "untrusted-project").note).toContain("Auto");
  });

  test("reads the person's own rules from the machine and the vault, and tolerates a bad file", () => {
    const configFolder = join(folder, "claude");
    mkdirSync(configFolder);
    writeFileSync(
      join(configFolder, "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(npm test:*)", 7], deny: ["Read(./.env)"], defaultMode: "plan" } }),
    );
    const vault = join(folder, "vault");
    mkdirSync(join(vault, ".claude"), { recursive: true });
    writeFileSync(join(vault, ".claude", "settings.json"), "{ not json");

    const permissions = describeClaudePermissions("auto", {
      vaultFolder: vault,
      environment: { CLAUDE_CONFIG_DIR: configFolder },
    });

    expect(permissions.personRules).toEqual([
      {
        place: "machine",
        file: join(configFolder, "settings.json"),
        state: "ok",
        allow: ["Bash(npm test:*)"],
        ask: [],
        deny: ["Read(./.env)"],
      },
      { place: "vault", file: ".claude/settings.json", state: "invalid", allow: [], ask: [], deny: [] },
    ]);
  });

  test("lists a missing file, so the person sees where a rule would go", () => {
    const permissions = describeClaudePermissions("auto", {
      vaultFolder: join(folder, "vault"),
      environment: { CLAUDE_CONFIG_DIR: join(folder, "claude") },
    });
    expect(permissions.personRules?.map((rules) => rules.state)).toEqual(["missing", "missing"]);
  });

  test("the engine describes the mode it runs with", () => {
    const engine = new ClaudeCodeEngine({ executable: "claude", permissionMode: "bypassPermissions" });
    expect(engine.describePermissions(noRules).mode?.value).toBe("bypassPermissions");
    expect(new ClaudeCodeEngine({ executable: "claude" }).describePermissions(noRules).mode?.value).toBe("auto");
  });
});
