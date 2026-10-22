/**
 * The engine port: what the core asks of an engine adapter (Claude Code, pi). The core
 * never imports an adapter; `src/main.ts` passes the adapters in.
 */
import type { EngineEventPayload } from "./events.ts";

export type EngineName = "claude-code" | "pi";
export type SessionMode = "assistant" | "project";
/**
 * What a turn runs as. A model call is one question with one answer, outside every chat: no tools,
 * no settings, no context files and no saved session. It is no session mode, so no record stores it.
 */
export type TurnMode = SessionMode | "model-call";
export type ModelAlias = "default" | "opus" | "sonnet" | "haiku";
/** How much the model reasons before it answers. `default` keeps the engine's own level. */
export const effortLevels = ["default", "low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof effortLevels)[number];

/** Where the turn's history comes from. */
export type TurnHistory =
  /** A new conversation with an id that Eva chose before the turn (lesson 44). */
  | { readonly kind: "new"; readonly engineSessionId: string }
  /** Continue an existing conversation. */
  | { readonly kind: "continue"; readonly engineSessionId: string }
  /** A new branch of an existing conversation, up to and including one message. */
  | { readonly kind: "fork"; readonly fromEngineSessionId: string; readonly atMessageId: string };

export interface ApprovalRequest {
  readonly requestId: string;
  readonly toolName: string;
  readonly summary: string;
}

export type ApprovalAnswer = "allow" | "deny";

/** A local MCP server that the engine starts for the turn, such as the Google tools. */
export interface McpServerSpec {
  readonly command: string;
  readonly args: readonly string[];
  /** The whole environment of the server process (lesson 96). */
  readonly environment: Readonly<Record<string, string>>;
}

export interface TurnRequest {
  readonly mode: TurnMode;
  readonly history: TurnHistory;
  readonly startFolder: string;
  readonly prompt: string;
  readonly model: ModelAlias;
  readonly effort: EffortLevel;
  /**
   * Assistant mode: Eva's prompt. Claude Code uses it in place of its own system prompt; pi appends it.
   * Byte-identical every turn (lesson 40). A model call: the caller's prompt, in place of each engine's own.
   */
  readonly appendSystemPrompt: string | null;
  /** Assistant mode: local plugin folders, such as the vault's `.eva/`. */
  readonly pluginFolders: readonly string[];
  /** Assistant mode: the MCP servers that Eva adds. Project mode: none, so the clone's own apply. */
  readonly mcpServers: Readonly<Record<string, McpServerSpec>>;
  /** Project mode: false runs the clone with its hooks and project MCP servers off. */
  readonly trusted: boolean;
  /** The whole environment of the engine process (lesson 96). */
  readonly environment: Readonly<Record<string, string>>;
  readonly requestApproval: (request: ApprovalRequest) => Promise<ApprovalAnswer>;
  readonly signal: AbortSignal;
}

export interface EnginePort {
  readonly name: EngineName;
  /** Runs one turn. The stream ends with exactly one `turn_finished` or `turn_failed`. */
  runTurn(request: TurnRequest): AsyncIterable<EngineEventPayload>;
}
