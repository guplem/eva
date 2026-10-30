/**
 * The parts of a chat's context that Claude Code adds, by the rules that the adapter's options
 * give it: its own prompt, its instruction files and its skills.
 */
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ContextPart, EngineContextInput } from "../../shared/chat-context.ts";
import { instructionPart, instructionPartsIn, skillParts } from "../../shared/context-files.ts";

/**
 * The folders from the start folder up to the root, outermost first. A Project chat stops at its
 * project folder: Eva hides each instruction file above it (#702).
 */
function foldersUpTo(startFolder: string, projectFolder: string | null): string[] {
  const stop = projectFolder === null ? null : resolve(projectFolder);
  const folders: string[] = [];
  for (let folder = resolve(startFolder); ; folder = dirname(folder)) {
    folders.unshift(folder);
    if (folder === stop || dirname(folder) === folder) break;
  }
  return folders;
}

/**
 * The instruction files that Claude Code reads with the `project` source, outermost first, so
 * the nearest file comes last and wins. Claude Code reads each `CLAUDE.md` from the start folder
 * up to the root, and each `AGENTS.md` only when none of those folders has a `CLAUDE.md`. Above a
 * project folder, Eva hides every file, so a hidden `CLAUDE.md` no longer hides an `AGENTS.md`.
 */
export function projectInstructionFiles(startFolder: string, projectFolder: string | null): string[] {
  const folders = foldersUpTo(startFolder, projectFolder);
  const existing = (names: readonly string[]): string[] =>
    folders.flatMap((folder) =>
      names.map((name) => join(folder, name)).filter((path) => instructionPart(path, startFolder) !== null),
    );
  const claudeFiles = existing(["CLAUDE.md", join(".claude", "CLAUDE.md")]);
  return claudeFiles.length > 0 ? claudeFiles : existing(["AGENTS.md"]);
}

const assistantPromptNote =
  "In an Assistant chat, Eva's prompt takes the place of Claude Code's own prompt. Claude Code adds only a line that names itself.";
const projectPromptNote = "Claude Code keeps its own prompt inside, so Eva cannot show its text.";

/** A nested file loads only when the agent reads a file in its folder (lesson 2). */
const repositoryNote = "Claude Code reads this when the agent works in this repository.";

const pathRuleNote = "Claude Code reads this rule only when the agent works on a file that its paths name.";

/** The rules of a rules folder. A rule with `paths` in its front matter loads only for those files. */
function rulesIn(folder: string, startFolder: string): ContextPart[] {
  return instructionPartsIn(folder, startFolder).map((part) =>
    /^---\r?\n(?:.*\r?\n)*?paths\s*:/.test(part.text ?? "") ? { ...part, note: pathRuleNote } : part,
  );
}

/** The instruction files and skills of each repository under the clone folder, which load on demand. */
function repositoryParts(cloneFolder: string, localSource: boolean): ContextPart[] {
  return repositoryFolders(cloneFolder).flatMap((repository) => {
    const files = (names: readonly string[]): ContextPart[] =>
      names.flatMap((name) => instructionPart(join(repository, name), cloneFolder) ?? []);
    const claudeFiles = files(["CLAUDE.md", join(".claude", "CLAUDE.md")]);
    return [
      ...(claudeFiles.length > 0 ? claudeFiles : files(["AGENTS.md"])),
      ...(localSource ? files(["CLAUDE.local.md"]) : []),
      ...rulesIn(join(repository, ".claude", "rules"), cloneFolder),
      // A nested skill answers to its name only after the agent reads a file in its folder (lesson 7).
      ...skillParts(join(repository, ".claude", "skills")),
    ].map((part) => ({ ...part, note: repositoryNote }));
  });
}

/** Each folder right under the clone folder: one for each repository (the vault layout in AGENTS.md). */
function repositoryFolders(cloneFolder: string): string[] {
  try {
    return readdirSync(cloneFolder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(cloneFolder, entry.name))
      .sort();
  } catch {
    return [];
  }
}

export function describeClaudeContext(input: EngineContextInput): ContextPart[] {
  const configFolder = input.environment["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude");
  const ownPrompt: ContextPart = {
    group: "prompt",
    title: "Claude Code's prompt",
    source: null,
    text: null,
    note: input.mode === "assistant" ? assistantPromptNote : projectPromptNote,
  };
  // An untrusted clone runs with the user source only. Eva then adds its instruction files to the prompt herself.
  const projectSource = input.mode === "assistant" || input.trusted;
  // Only a trusted Project chat has the `local` source, which reads each `CLAUDE.local.md`.
  const localSource = input.mode === "project" && input.trusted;
  const folders = foldersUpTo(input.startFolder, input.projectFolder);
  const files = [
    join(configFolder, "CLAUDE.md"),
    ...projectInstructionFiles(input.startFolder, input.projectFolder),
    ...(localSource ? folders.map((folder) => join(folder, "CLAUDE.local.md")) : []),
  ];
  const instructions = [
    ...files.flatMap((path) => instructionPart(path, input.startFolder) ?? []),
    ...rulesIn(join(configFolder, "rules"), input.startFolder),
    // Claude Code reads the rules of each folder from the start folder up, as its CLAUDE.md files.
    ...(projectSource ? folders.flatMap((folder) => rulesIn(join(folder, ".claude", "rules"), input.startFolder)) : []),
  ];
  const skillFolders = [
    ...input.pluginFolders.map((folder) => join(folder, "skills")),
    join(configFolder, "skills"),
    // Claude Code finds skills from the start folder up to the root (lesson 5). Eva hides none of them.
    ...(projectSource
      ? foldersUpTo(input.startFolder, null)
          .reverse()
          .map((folder) => join(folder, ".claude", "skills"))
      : []),
  ];
  const nested = input.mode === "project" && projectSource ? repositoryParts(input.startFolder, localSource) : [];
  return [ownPrompt, ...instructions, ...skillFolders.flatMap(skillParts), ...nested];
}
