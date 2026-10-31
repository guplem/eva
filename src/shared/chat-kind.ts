/**
 * The three levels of a chat (#703): the Assistant at the vault root, a specialist in its project
 * folder, and project work in a clone. A specialist chat is stored as a Project chat with no clone,
 * because an older Eva reads `mode` strictly.
 */
import type { SessionMode } from "./engine-port.ts";

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

/** The name that every front end shows for a kind of chat. */
export function chatKindName(kind: ChatKind): string {
  return kindNames[kind];
}
