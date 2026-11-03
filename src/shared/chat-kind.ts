/**
 * The three levels of a chat (#703): the Assistant at the vault root, a chat in a project folder,
 * and project work in a clone. A chat in a project folder is stored as a Project chat with no
 * clone, because an older Eva reads `mode` strictly. Its kind is "specialist" for every project
 * type: a general chat works the same way (#768). Only its name follows the type.
 */
import type { SessionMode } from "./engine-port.ts";
import type { ProjectType } from "./project-types.ts";

export type ChatKind = "assistant" | "specialist" | "project";

export function chatKind(chat: { readonly mode: SessionMode; readonly clone: string | null }): ChatKind {
  if (chat.mode === "assistant") return "assistant";
  return chat.clone === null ? "specialist" : "project";
}

const kindNames: Readonly<Record<ChatKind, string>> = {
  assistant: "Assistant",
  specialist: "Specialist",
  project: "Project",
};

/**
 * The name that every front end shows for a kind of chat. A chat in a project folder is
 * "Project" in a general project, and "Specialist" otherwise, as before #768.
 */
export function chatKindName(kind: ChatKind, projectType?: ProjectType): string {
  if (kind === "specialist" && projectType === "general") return kindNames.project;
  return kindNames[kind];
}
