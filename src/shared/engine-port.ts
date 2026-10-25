/**
 * The engine port: what the core asks of an engine adapter (Claude Code, pi). The core
 * never imports an adapter; `src/main.ts` passes the adapters in.
 */
import type { ApprovalQuestion, EngineEventPayload, QuestionAnswers } from "./events.ts";
import type { EnginePermissions, PermissionContext } from "./permissions.ts";

export type EngineName = "claude-code" | "pi";
export type SessionMode = "assistant" | "project";
/**
 * What a turn runs as. A model call is one question with one answer, outside every chat: no tools,
 * no settings, no context files and no saved session. It is no session mode, so no record stores it.
 */
export type TurnMode = SessionMode | "model-call";
/**
 * The model tiers, stored by alias (lesson 121). Claude Code runs the newest model of each family;
 * pi runs the model that the settings name for the tier.
 */
export const modelAliases = ["opus", "sonnet", "haiku"] as const;
export type ModelAlias = (typeof modelAliases)[number];
/** How much the model reasons before it answers. */
export const effortLevels = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof effortLevels)[number];

const tierNames: Readonly<Record<ModelAlias, string>> = { opus: "Smart", sonnet: "Balanced", haiku: "Fast" };

/** The name that every front end shows for a model alias. */
export function modelTierName(model: ModelAlias): string {
  return tierNames[model];
}

/** Claude Code's Haiku takes no effort level, so Eva sends none and offers none. */
export function takesEffort(engine: EngineName, model: ModelAlias): boolean {
  return !(engine === "claude-code" && model === "haiku");
}

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

/** `declined`: the person chose not to answer. `expired`: nobody answered in time, or the turn stopped. */
export type QuestionsOutcome = QuestionAnswers | "declined" | "expired";

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
  /**
   * The tier of the chat's turn before, which may still hold the engine's model. Absent for a first
   * turn or a model call. pi keeps a session's model when Eva names none (#552).
   */
  readonly previousModel?: ModelAlias;
  /** Null: the engine keeps its own level, as for a model call or a model with no effort. */
  readonly effort: EffortLevel | null;
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
  /** Shows the model's questions to the person and waits for the answers. */
  readonly askQuestions: (toolName: string, questions: readonly ApprovalQuestion[]) => Promise<QuestionsOutcome>;
  readonly signal: AbortSignal;
}

export interface EnginePort {
  readonly name: EngineName;
  /** Runs one turn. The stream ends with exactly one `turn_finished` or `turn_failed`. */
  runTurn(request: TurnRequest): AsyncIterable<EngineEventPayload>;
  /** What this engine may do in each kind of chat, for Settings. Without it, Settings shows no rules. */
  describePermissions?(context: PermissionContext): EnginePermissions;
  /**
   * Makes the history of an engine session readable from another folder, so a fork there can go on
   * from it (issue 523). False when it could not. An engine that keeps every session in one place
   * needs no such step.
   */
  carryHistory?(input: CarryHistoryInput): boolean;
}

export interface CarryHistoryInput {
  readonly engineSessionId: string;
  readonly toFolder: string;
  /** The environment of the engine's turns, which names its config folder. */
  readonly environment: Readonly<Record<string, string>>;
}
