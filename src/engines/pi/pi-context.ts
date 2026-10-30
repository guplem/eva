/**
 * The parts of a chat's context that pi adds, by pi's own rules: its own prompt, its context
 * files and its skills. The arguments in pi-adapter.ts turn none of them off in a chat.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ContextPart, EngineContextInput } from "../../shared/chat-context.ts";
import { instructionPart, skillParts } from "../../shared/context-files.ts";

/** pi reads the first of these names in each folder. */
const contextFileNames = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

function contextFileIn(folder: string): string | null {
  return contextFileNames.map((name) => join(folder, name)).find((path) => existsSync(path)) ?? null;
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
  const repositoryEnd = folders.findIndex((folder) => existsSync(join(folder, ".git")));
  return folders
    .slice(0, repositoryEnd === -1 ? folders.length : repositoryEnd + 1)
    .map((folder) => join(folder, ".agents", "skills"));
}

const assistantPromptNote = "pi keeps its own prompt inside, so Eva cannot show its text. Eva's prompt follows it.";
const projectPromptNote = "pi keeps its own prompt inside, so Eva cannot show its text.";

export function describePiContext(input: EngineContextInput): ContextPart[] {
  const agentFolder = input.environment["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
  const home = input.environment["HOME"] ?? homedir();
  const ownPrompt: ContextPart = {
    group: "prompt",
    title: "pi's prompt",
    source: null,
    text: null,
    note: input.mode === "assistant" ? assistantPromptNote : projectPromptNote,
  };
  const files = [agentFolder, ...foldersUpTo(input.startFolder)].flatMap((folder) => contextFileIn(folder) ?? []);
  const instructions = [...new Set(files)].flatMap((path) => instructionPart(path, input.startFolder) ?? []);
  const userAgentsSkills = join(home, ".agents", "skills");
  const skillFolders = [
    ...input.pluginFolders.map((folder) => join(folder, "skills")),
    join(input.startFolder, ".pi", "skills"),
    ...agentsSkillFolders(input.startFolder).filter((folder) => resolve(folder) !== resolve(userAgentsSkills)),
    join(agentFolder, "skills"),
    userAgentsSkills,
  ];
  return [ownPrompt, ...instructions, ...skillFolders.flatMap(skillParts)];
}
