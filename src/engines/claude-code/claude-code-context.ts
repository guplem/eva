/**
 * The parts of a chat's context that Claude Code adds, by the rules that the adapter's options
 * give it: its own prompt, its instruction files and its skills.
 */
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ContextPart, EngineContextInput } from "../../shared/chat-context.ts";
import { instructionPart, skillParts } from "../../shared/context-files.ts";

/**
 * The instruction files that Claude Code reads with the `project` source, outermost first, so
 * the nearest file comes last and wins. Claude Code reads each `CLAUDE.md` from the start folder
 * up to the root, and each `AGENTS.md` only when none of those folders has a `CLAUDE.md`.
 */
export function projectInstructionFiles(startFolder: string): string[] {
  const folders: string[] = [];
  for (let folder = resolve(startFolder); ; folder = dirname(folder)) {
    folders.unshift(folder);
    if (dirname(folder) === folder) break;
  }
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
  const instructions = [join(configFolder, "CLAUDE.md"), ...projectInstructionFiles(input.startFolder)].flatMap(
    (path) => instructionPart(path, input.startFolder) ?? [],
  );
  const skillFolders = [
    ...input.pluginFolders.map((folder) => join(folder, "skills")),
    join(configFolder, "skills"),
    ...(projectSource ? [join(input.startFolder, ".claude", "skills")] : []),
  ];
  return [ownPrompt, ...instructions, ...skillFolders.flatMap(skillParts)];
}
