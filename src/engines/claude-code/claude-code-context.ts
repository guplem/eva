/**
 * The parts of a chat's context that Claude Code adds, by the rules that the adapter's options
 * give it: its own prompt, its instruction files and its skills.
 */
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ContextPart, EngineContextInput } from "../../shared/chat-context.ts";
import { instructionPart, instructionPartsIn, skillParts } from "../../shared/context-files.ts";

/** The folders from the start folder up to the root, outermost first. */
function foldersUpTo(startFolder: string): string[] {
  const folders: string[] = [];
  for (let folder = resolve(startFolder); ; folder = dirname(folder)) {
    folders.unshift(folder);
    if (dirname(folder) === folder) break;
  }
  return folders;
}

/**
 * The instruction files that Claude Code reads with the `project` source, outermost first, so
 * the nearest file comes last and wins. Claude Code reads each `CLAUDE.md` from the start folder
 * up to the root, and each `AGENTS.md` only when none of those folders has a `CLAUDE.md`.
 */
export function projectInstructionFiles(startFolder: string): string[] {
  const folders = foldersUpTo(startFolder);
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

/** The instruction files and skills of each repository under the clone folder, which load on demand. */
function repositoryParts(cloneFolder: string): ContextPart[] {
  return repositoryFolders(cloneFolder).flatMap((repository) => {
    const files = (names: readonly string[]): ContextPart[] =>
      names.flatMap((name) => instructionPart(join(repository, name), cloneFolder) ?? []);
    const claudeFiles = files(["CLAUDE.md", join(".claude", "CLAUDE.md")]);
    return [
      ...(claudeFiles.length > 0 ? claudeFiles : files(["AGENTS.md"])),
      ...instructionPartsIn(join(repository, ".claude", "rules"), cloneFolder),
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
  const folders = foldersUpTo(input.startFolder);
  const files = [
    join(configFolder, "CLAUDE.md"),
    ...projectInstructionFiles(input.startFolder),
    ...(localSource ? folders.map((folder) => join(folder, "CLAUDE.local.md")) : []),
  ];
  const instructions = [
    ...files.flatMap((path) => instructionPart(path, input.startFolder) ?? []),
    ...instructionPartsIn(join(configFolder, "rules"), input.startFolder),
    ...(projectSource ? instructionPartsIn(join(input.startFolder, ".claude", "rules"), input.startFolder) : []),
  ];
  const skillFolders = [
    ...input.pluginFolders.map((folder) => join(folder, "skills")),
    join(configFolder, "skills"),
    // Claude Code finds skills from the start folder up to the root (lesson 5).
    ...(projectSource ? folders.reverse().map((folder) => join(folder, ".claude", "skills")) : []),
  ];
  const nested = input.mode === "project" && projectSource ? repositoryParts(input.startFolder) : [];
  return [ownPrompt, ...instructions, ...skillFolders.flatMap(skillParts), ...nested];
}
