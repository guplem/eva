/**
 * The parts of a chat's context that pi adds, by pi's own rules (pi 1.4): its own prompt, its
 * context files and its skills. The arguments in pi-adapter.ts turn none of them off in a chat.
 */
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ContextPart, EngineContextInput } from "../../shared/chat-context.ts";
import { instructionPart, skillParts } from "../../shared/context-files.ts";

/** pi reads the first of these names in each folder. */
const contextFileNames = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

/** pi keeps its own trust answer for each folder, which Eva cannot read. */
const folderTrustNote = "pi reads this only when it trusts the folder.";

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function contextFileIn(folder: string): string | null {
  return contextFileNames.map((name) => join(folder, name)).find(isFile) ?? null;
}

/** The folders from the start folder up to the root, outermost first. */
function foldersUpTo(startFolder: string): string[] {
  const folders: string[] = [];
  for (let folder = resolve(startFolder); ; folder = dirname(folder)) {
    folders.unshift(folder);
    if (dirname(folder) === folder) break;
  }
  return folders;
}

/** pi reads `.agents/skills` from the start folder up to its repository root, or up to the root with no repository. */
function agentsSkillFolders(startFolder: string): string[] {
  const folders = foldersUpTo(startFolder).reverse();
  // A worktree has a `.git` file, not a folder.
  const repositoryEnd = folders.findIndex((folder) => exists(join(folder, ".git")));
  return folders
    .slice(0, repositoryEnd === -1 ? folders.length : repositoryEnd + 1)
    .map((folder) => join(folder, ".agents", "skills"));
}

/** pi takes the start folder's `.pi/` file first, then the agent folder's file. */
function promptFile(name: string, startFolder: string, agentFolder: string): string | null {
  return [join(startFolder, ".pi", name), join(agentFolder, name)].find(isFile) ?? null;
}

function promptPart(title: string, path: string, startFolder: string): ContextPart[] {
  const part = instructionPart(path, startFolder);
  if (part === null) return [];
  const inFolder = dirname(path) === join(startFolder, ".pi");
  return [{ ...part, group: "prompt", title, note: inFolder ? folderTrustNote : null }];
}

export function describePiContext(input: EngineContextInput): ContextPart[] {
  const agentFolder = input.environment["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
  const home = input.environment["HOME"] ?? homedir();
  const system = promptFile("SYSTEM.md", input.startFolder, agentFolder);
  // In an Assistant chat, Eva's prompt takes the place of an APPEND_SYSTEM.md (`--append-system-prompt`).
  const append = input.mode === "project" ? promptFile("APPEND_SYSTEM.md", input.startFolder, agentFolder) : null;
  const ownPrompt: ContextPart = {
    group: "prompt",
    title: "pi's prompt",
    source: null,
    text: null,
    note: [
      system === null
        ? "pi keeps its own prompt inside, so Eva cannot show its text."
        : "A SYSTEM.md file takes the place of pi's own prompt when pi reads it.",
      ...(input.mode === "assistant" ? ["Eva's prompt follows it."] : []),
    ].join(" "),
  };
  const prompts = [
    ...(system === null ? [] : promptPart("pi's prompt file", system, input.startFolder)),
    ...(append === null ? [] : promptPart("Added to pi's prompt", append, input.startFolder)),
  ];
  const files = [agentFolder, ...foldersUpTo(input.startFolder)].flatMap((folder) => contextFileIn(folder) ?? []);
  const instructions = [...new Set(files)].flatMap((path) => instructionPart(path, input.startFolder) ?? []);
  const userAgentsSkills = join(home, ".agents", "skills");
  const folderSkills = [
    join(input.startFolder, ".pi", "skills"),
    ...agentsSkillFolders(input.startFolder).filter((folder) => resolve(folder) !== resolve(userAgentsSkills)),
  ]
    .flatMap(skillParts)
    .map((part) => ({ ...part, note: folderTrustNote }));
  return [
    ownPrompt,
    ...prompts,
    ...instructions,
    ...input.pluginFolders.flatMap((folder) => skillParts(join(folder, "skills"))),
    ...folderSkills,
    ...skillParts(join(agentFolder, "skills")),
    ...skillParts(userAgentsSkills),
  ];
}
