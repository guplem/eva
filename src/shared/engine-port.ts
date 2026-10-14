/**
 * The engine port: what the core asks of an engine adapter (Claude Code, pi). The core
 * never imports an adapter; `src/main.ts` passes the adapters in (docs/plan.md §4.2).
 */
import type { EngineEventPayload } from "./events.ts";

export type EngineName = "claude-code" | "pi";
export type SessionMode = "assistant" | "project";
export type ModelAlias = "default" | "opus" | "sonnet" | "haiku";

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

/** A local MCP server that the engine starts for the turn, such as the Google tools (plan §9). */
export interface McpServerSpec {
  readonly command: string;
  readonly args: readonly string[];
  /** The whole environment of the server process (lesson 96). */
  readonly environment: Readonly<Record<string, string>>;
}

export interface TurnRequest {
  readonly mode: SessionMode;
  readonly history: TurnHistory;
  readonly startFolder: string;
  readonly prompt: string;
  readonly model: ModelAlias;
  /** Assistant mode: the text appended to the engine's own system prompt. Byte-identical every turn (lesson 40). */
  readonly appendSystemPrompt: string | null;
  /** Assistant mode: local plugin folders, such as the vault's `.eva/`. */
  readonly pluginFolders: readonly string[];
  /** Assistant mode: the MCP servers that Eva adds. Project mode: none, so the clone's own apply (D8). */
  readonly mcpServers: Readonly<Record<string, McpServerSpec>>;
  /** Project mode: false runs the clone with its hooks and project MCP servers off (plan §12). */
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
