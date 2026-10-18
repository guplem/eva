/**
 * The one vocabulary that crosses the engine port. An engine adapter
 * emits payloads; the core stamps each one with its session, a sequence number and a
 * time, and sends it to every front end.
 */

export interface TurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export type TaskState = "running" | "done" | "failed";

/** A command runs in a shell; a tool is every other tool call. The activity chips count each kind. */
export type ToolCategory = "command" | "tool";

export type EngineEventPayload =
  | { readonly kind: "text"; readonly text: string; readonly messageId: string }
  | {
      readonly kind: "tool_started";
      readonly toolUseId: string;
      readonly name: string;
      readonly category: ToolCategory;
      readonly summary: string;
    }
  | { readonly kind: "tool_finished"; readonly toolUseId: string; readonly isError: boolean }
  | { readonly kind: "task_changed"; readonly taskId: string; readonly description: string; readonly state: TaskState }
  | {
      readonly kind: "approval_needed";
      readonly requestId: string;
      readonly toolName: string;
      readonly summary: string;
    }
  /** The first answer to an approval won; every other front end closes its question. */
  | {
      readonly kind: "approval_resolved";
      readonly requestId: string;
      readonly answer: "allow" | "deny";
      /** True when nobody answered in time and the core denied it. */
      readonly timedOut: boolean;
    }
  | { readonly kind: "history_lost" }
  | { readonly kind: "notice"; readonly text: string }
  | {
      readonly kind: "turn_finished";
      readonly engineSessionId: string;
      readonly lastMessageId: string | null;
      /** The sum over every model call of the turn. */
      readonly usage: TurnUsage;
      readonly costUsd: number | null;
      /** The input tokens of the turn's last top-level model call: how full the context is now. */
      readonly contextTokens: number | null;
    }
  | { readonly kind: "turn_failed"; readonly reason: string };

/** A payload as a front end receives it. */
export type SessionEvent = EngineEventPayload & {
  readonly sessionId: string;
  readonly seq: number;
  readonly at: string;
};

/** True for the two kinds that end a turn. Every turn stream ends with exactly one (lesson 47). */
export function isTurnEnd(
  event: EngineEventPayload,
): event is Extract<EngineEventPayload, { kind: "turn_finished" | "turn_failed" }> {
  return event.kind === "turn_finished" || event.kind === "turn_failed";
}
