import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeClaudeContext } from "../../../../src/engines/claude-code/claude-code-context.ts";
import type { EngineContextInput } from "../../../../src/shared/chat-context.ts";

let folder: string;
let config: string;
let vault: string;

function write(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function input(overrides: Partial<EngineContextInput> = {}): EngineContextInput {
  return {
    mode: "assistant",
    startFolder: vault,
    trusted: true,
    pluginFolders: [],
    environment: { CLAUDE_CONFIG_DIR: config },
    ...overrides,
  };
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-claude-context-"));
  config = join(folder, "claude");
  vault = join(folder, "vault");
  mkdirSync(vault, { recursive: true });
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("describeClaudeContext", () => {
  test("names its own prompt, which Eva cannot read", () => {
    const [assistant] = describeClaudeContext(input());
    expect(assistant).toMatchObject({ group: "prompt", title: "Claude Code's prompt", text: null });
    expect(assistant?.note).toContain("Eva's prompt takes the place");
    const [project] = describeClaudeContext(input({ mode: "project" }));
    expect(project?.note).toContain("cannot show its text");
  });

  test("lists the user file, then each AGENTS.md from the outermost folder", () => {
    write(join(config, "CLAUDE.md"), "User rules.");
    write(join(folder, "AGENTS.md"), "Outer rules.");
    write(join(vault, "AGENTS.md"), "Vault rules.");
    const instructions = describeClaudeContext(input()).filter((part) => part.group === "instructions");
    expect(instructions.map((part) => [part.source, part.text])).toEqual([
      [join(config, "CLAUDE.md"), "User rules."],
      [join(folder, "AGENTS.md"), "Outer rules."],
      [join(vault, "AGENTS.md"), "Vault rules."],
    ]);
    expect(instructions[2]?.title).toBe("AGENTS.md");
  });

  test("reads no AGENTS.md when a folder has a CLAUDE.md", () => {
    write(join(vault, "AGENTS.md"), "Vault rules.");
    write(join(vault, ".claude", "CLAUDE.md"), "Claude rules.");
    const instructions = describeClaudeContext(input()).filter((part) => part.group === "instructions");
    expect(instructions.map((part) => part.text)).toEqual(["Claude rules."]);
  });

  test("lists the skills of the plugins, the user folder and the project", () => {
    write(join(vault, ".eva", "skills", "write-note", "SKILL.md"), "Write a note.");
    write(join(config, "skills", "own-skill", "SKILL.md"), "A skill of the person.");
    write(join(vault, ".claude", "skills", "project-skill", "SKILL.md"), "A skill of the folder.");
    const skills = (overrides: Partial<EngineContextInput>): string[] =>
      describeClaudeContext(input(overrides))
        .filter((part) => part.group === "skills")
        .map((part) => part.title);
    expect(skills({ pluginFolders: [join(vault, ".eva")] })).toEqual(["write-note", "own-skill", "project-skill"]);
    expect(skills({ mode: "project", trusted: true })).toEqual(["own-skill", "project-skill"]);
    // An untrusted clone runs with the user's settings only.
    expect(skills({ mode: "project", trusted: false })).toEqual(["own-skill"]);
  });
});
