import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeClaudeContext } from "../../../../src/engines/claude-code/claude-code-context.ts";
import type { ContextPart, EngineContextInput } from "../../../../src/shared/chat-context.ts";

let folder: string;
let config: string;
let vault: string;

function write(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** The parts from the test's own folder only: the engine walks up to the root, past the temporary folder. */
function context(given: EngineContextInput): ContextPart[] {
  return describeClaudeContext(given).filter((part) => part.source === null || part.source.startsWith(folder));
}

function input(overrides: Partial<EngineContextInput> = {}): EngineContextInput {
  return {
    mode: "assistant",
    startFolder: vault,
    projectFolder: null,
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
    const [assistant] = context(input());
    expect(assistant).toMatchObject({ group: "prompt", title: "Claude Code's prompt", text: null });
    expect(assistant?.note).toContain("Eva's prompt takes the place");
    const [project] = context(input({ mode: "project" }));
    expect(project?.note).toContain("cannot show its text");
  });

  test("lists the user file, then each AGENTS.md from the outermost folder", () => {
    write(join(config, "CLAUDE.md"), "User rules.");
    write(join(folder, "AGENTS.md"), "Outer rules.");
    write(join(vault, "AGENTS.md"), "Vault rules.");
    const instructions = context(input()).filter((part) => part.group === "instructions");
    expect(instructions.map((part) => [part.source, part.text])).toEqual([
      [join(config, "CLAUDE.md"), "User rules."],
      [join(folder, "AGENTS.md"), "Outer rules."],
      [join(vault, "AGENTS.md"), "Vault rules."],
    ]);
    expect(instructions[2]?.title).toBe("AGENTS.md");
  });

  test("a Project chat lists no instruction file above its project folder, which Claude Code hides (#702)", () => {
    const project = join(vault, "Projects", "example-app");
    write(join(folder, "CLAUDE.md"), "Outer Claude rules.");
    write(join(vault, "AGENTS.md"), "Vault map.");
    write(join(project, "AGENTS.md"), "Project rules.");
    const instructions = context(
      input({ mode: "project", startFolder: join(project, "repos", "clone-0"), projectFolder: project }),
    ).filter((part) => part.group === "instructions");
    // A hidden CLAUDE.md above no longer hides the project's AGENTS.md.
    expect(instructions.map((part) => part.text)).toEqual(["Project rules."]);
  });

  test("reads no AGENTS.md when a folder has a CLAUDE.md", () => {
    write(join(vault, "AGENTS.md"), "Vault rules.");
    write(join(vault, ".claude", "CLAUDE.md"), "Claude rules.");
    const instructions = context(input()).filter((part) => part.group === "instructions");
    expect(instructions.map((part) => part.text)).toEqual(["Claude rules."]);
  });

  test("lists the skills of the plugins, the user folder and the project", () => {
    write(join(vault, ".eva", "skills", "write-note", "SKILL.md"), "Write a note.");
    write(join(config, "skills", "own-skill", "SKILL.md"), "A skill of the person.");
    write(join(vault, ".claude", "skills", "project-skill", "SKILL.md"), "A skill of the folder.");
    const skills = (overrides: Partial<EngineContextInput>): string[] =>
      context(input(overrides))
        .filter((part) => part.group === "skills")
        .map((part) => part.title);
    expect(skills({ pluginFolders: [join(vault, ".eva")] })).toEqual(["write-note", "own-skill", "project-skill"]);
    expect(skills({ mode: "project", trusted: true })).toEqual(["own-skill", "project-skill"]);
    // An untrusted clone runs with the user's settings only.
    expect(skills({ mode: "project", trusted: false })).toEqual(["own-skill"]);
  });
});

describe("describeClaudeContext, rules and local files", () => {
  test("lists the rules folders, and CLAUDE.local.md only in a trusted Project chat", () => {
    write(join(config, "rules", "tone.md"), "User rule.");
    write(join(vault, ".claude", "rules", "nested", "tests.md"), "Project rule.");
    write(join(vault, ".claude", "rules", "notes.txt"), "Not Markdown.");
    write(join(vault, "CLAUDE.local.md"), "Local rules.");
    const texts = (overrides: Partial<EngineContextInput>): (string | null)[] =>
      context(input(overrides))
        .filter((part) => part.group === "instructions")
        .map((part) => part.text);
    expect(texts({})).toEqual(["User rule.", "Project rule."]);
    expect(texts({ mode: "project", trusted: true })).toEqual(["Local rules.", "User rule.", "Project rule."]);
    expect(texts({ mode: "project", trusted: false })).toEqual(["User rule."]);
  });
});

describe("describeClaudeContext above and below the start folder", () => {
  test("lists the skills of each folder above the start folder (lesson 5)", () => {
    const clone = join(vault, "Projects", "example-app", "repos", "clone-1");
    mkdirSync(clone, { recursive: true });
    write(join(vault, ".claude", "skills", "vault-skill", "SKILL.md"), "From the vault root.");
    const skills = context(input({ mode: "project", startFolder: clone }))
      .filter((part) => part.group === "skills")
      .map((part) => part.title);
    expect(skills).toEqual(["vault-skill"]);
  });

  test("lists each repository's own files in a trusted Project chat, as files that load on demand", () => {
    const clone = join(folder, "clone-1");
    write(join(clone, "example-app", "AGENTS.md"), "Repository rules.");
    write(join(clone, "example-app", ".claude", "skills", "run-tests", "SKILL.md"), "Run the tests.");
    write(join(clone, "example-api", "CLAUDE.md"), "API rules.");
    write(join(clone, "example-api", "AGENTS.md"), "Not read: CLAUDE.md wins.");
    const nested = (trusted: boolean): [string, string | null][] =>
      context(input({ mode: "project", startFolder: clone, trusted }))
        .filter((part) => part.note?.includes("works in this repository") === true)
        .map((part) => [part.title, part.text]);
    expect(nested(true)).toEqual([
      [join("example-api", "CLAUDE.md"), "API rules."],
      [join("example-app", "AGENTS.md"), "Repository rules."],
      ["run-tests", "Run the tests."],
    ]);
    // Without the project source, Claude Code reads no nested file.
    expect(nested(false)).toEqual([]);
  });
});

describe("describeClaudeContext, second review", () => {
  test("lists the rules of each folder above the start folder, and notes a rule for some paths only", () => {
    const clone = join(vault, "Projects", "example-app", "repos", "clone-1");
    mkdirSync(clone, { recursive: true });
    write(join(vault, ".claude", "rules", "style.md"), "Vault rule.");
    write(join(clone, ".claude", "rules", "tests.md"), "---\npaths:\n  - test/**\n---\nTest rule.");
    const rules = context(input({ mode: "project", startFolder: clone }))
      .filter((part) => part.group === "instructions")
      .map((part) => [part.text, part.note]);
    expect(rules).toEqual([
      ["Vault rule.", null],
      [
        "---\npaths:\n  - test/**\n---\nTest rule.",
        "Claude Code reads this rule only when the agent works on a file that its paths name.",
      ],
    ]);
  });

  test("lists a repository's CLAUDE.local.md only in a trusted Project chat", () => {
    const clone = join(folder, "clone-1");
    write(join(clone, "example-app", "CLAUDE.local.md"), "Local repository rules.");
    const texts = (trusted: boolean): (string | null)[] =>
      context(input({ mode: "project", startFolder: clone, trusted })).map((part) => part.text);
    expect(texts(true)).toContain("Local repository rules.");
    expect(texts(false)).not.toContain("Local repository rules.");
  });
});
