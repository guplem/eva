/**
 * The context of a chat: each part that the agent reads before the conversation, such as the
 * system prompt, the instruction files and the skills. The chat details list them, so the person
 * can check why the agent acts as it does. The conversation itself is not a part.
 */

/** The groups, in the order that the chat details show them. */
export const contextGroups = ["prompt", "instructions", "skills", "message"] as const;
export type ContextGroup = (typeof contextGroups)[number];

export interface ContextPart {
  readonly group: ContextGroup;
  readonly title: string;
  /** Where the text comes from, such as a file path. Null for a text that Eva builds. */
  readonly source: string | null;
  /** The full text. Null when nobody but the engine can read it, as for Claude Code's own prompt. */
  readonly text: string | null;
  /** One more fact, such as why the text is missing. */
  readonly note: string | null;
}

/** What an engine needs to list the files that it reads in a chat. */
export interface EngineContextInput {
  readonly mode: "assistant" | "project";
  readonly startFolder: string;
  /** Project mode: the project folder. No instruction file above it reaches the chat (#702). */
  readonly projectFolder: string | null;
  /** False: an untrusted clone, whose own settings stay off. */
  readonly trusted: boolean;
  /** The plugin folders that Eva gives the engine, such as the vault's `.eva/`. */
  readonly pluginFolders: readonly string[];
  /** The environment of the engine's turns, which names its config folder. */
  readonly environment: Readonly<Record<string, string>>;
}
