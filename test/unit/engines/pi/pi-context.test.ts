import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describePiContext } from "../../../../src/engines/pi/pi-context.ts";
import type { EngineContextInput } from "../../../../src/shared/chat-context.ts";

let folder: string;
let agent: string;
let home: string;
let clone: string;

function write(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function input(overrides: Partial<EngineContextInput> = {}): EngineContextInput {
  return {
    mode: "project",
    startFolder: clone,
    trusted: true,
    pluginFolders: [],
    environment: { PI_CODING_AGENT_DIR: agent, HOME: home },
    ...overrides,
  };
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-pi-context-"));
  agent = join(folder, "pi-agent");
  home = join(folder, "home");
  clone = join(folder, "clone-1");
  mkdirSync(clone, { recursive: true });
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("describePiContext", () => {
  test("names its own prompt, which Eva cannot read", () => {
    const [own] = describePiContext(input());
    expect(own).toMatchObject({ group: "prompt", title: "pi's prompt", text: null });
    expect(describePiContext(input({ mode: "assistant" }))[0]?.note).toContain("Eva's prompt follows it");
  });

  test("lists the agent file, then the first context file of each folder from the outermost", () => {
    write(join(agent, "AGENTS.md"), "Global rules.");
    write(join(folder, "CLAUDE.md"), "Outer rules.");
    write(join(clone, "AGENTS.md"), "Clone rules.");
    write(join(clone, "CLAUDE.md"), "Not read: AGENTS.md comes first.");
    const instructions = describePiContext(input()).filter((part) => part.group === "instructions");
    expect(instructions.map((part) => part.text)).toEqual(["Global rules.", "Outer rules.", "Clone rules."]);
  });

  test("lists the skills of each folder that pi reads", () => {
    write(join(folder, "plugin", "skills", "from-eva", "SKILL.md"), "From Eva.");
    write(join(clone, ".pi", "skills", "from-pi-folder", "SKILL.md"), "From .pi.");
    write(join(clone, ".agents", "skills", "from-agents-folder", "SKILL.md"), "From .agents.");
    write(join(folder, ".agents", "skills", "above-repository", "SKILL.md"), "Past the repository root.");
    write(join(agent, "skills", "from-agent", "SKILL.md"), "From the agent folder.");
    write(join(home, ".agents", "skills", "from-home", "SKILL.md"), "From home.");
    mkdirSync(join(clone, ".git"));
    const skills = describePiContext(input({ pluginFolders: [join(folder, "plugin")] }))
      .filter((part) => part.group === "skills")
      .map((part) => part.title);
    expect(skills).toEqual(["from-eva", "from-pi-folder", "from-agents-folder", "from-agent", "from-home"]);
  });
});

describe("describePiContext, pi 1.4 rules", () => {
  test("reads AGENTS.override.md first, and skips a folder with that name", () => {
    write(join(clone, "AGENTS.override.md"), "Override rules.");
    write(join(clone, "AGENTS.md"), "Not read: the override comes first.");
    mkdirSync(join(folder, "AGENTS.override.md"));
    write(join(folder, "AGENTS.md"), "Outer rules.");
    const instructions = describePiContext(input()).filter((part) => part.group === "instructions");
    expect(instructions.map((part) => part.text)).toEqual(["Outer rules.", "Override rules."]);
  });

  test("lists SYSTEM.md and, in a Project chat, APPEND_SYSTEM.md, with the folder's file first", () => {
    write(join(agent, "SYSTEM.md"), "Agent system.");
    write(join(clone, ".pi", "SYSTEM.md"), "Folder system.");
    write(join(agent, "APPEND_SYSTEM.md"), "Agent append.");
    const prompts = (mode: EngineContextInput["mode"]): [string, string | null, string | null][] =>
      describePiContext(input({ mode }))
        .filter((part) => part.group === "prompt")
        .map((part) => [part.title, part.text, part.note]);
    expect(prompts("project")).toEqual([
      ["pi's prompt", null, "A SYSTEM.md file takes the place of pi's own prompt when pi reads it."],
      ["pi's prompt file", "Folder system.", "pi reads this only when it trusts the folder."],
      ["Added to pi's prompt", "Agent append.", null],
    ]);
    // Eva's own prompt takes the place of APPEND_SYSTEM.md in an Assistant chat.
    expect(prompts("assistant").map(([title]) => title)).toEqual(["pi's prompt", "pi's prompt file"]);
  });

  test("notes that the skills of the folder need pi's own trust", () => {
    write(join(clone, ".pi", "skills", "folder-skill", "SKILL.md"), "From the folder.");
    write(join(agent, "skills", "agent-skill", "SKILL.md"), "From the agent folder.");
    const notes = describePiContext(input())
      .filter((part) => part.group === "skills")
      .map((part) => [part.title, part.note]);
    expect(notes).toEqual([
      ["folder-skill", "pi reads this only when it trusts the folder."],
      ["agent-skill", null],
    ]);
  });
});
