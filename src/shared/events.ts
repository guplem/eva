/**
 * The one vocabulary that crosses the engine port. An engine adapter
 * emits payloads; the core stamps each one with its session, a sequence number and a
 * time, and sends it to every front end.
 */
import type { ProjectReport } from "./project-report.ts";

export interface TurnUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export type TaskState = "running" | "done" | "failed";

/** A command runs in a shell; a tool is every other tool call. The activity chips count each kind. */
export type ToolCategory = "command" | "tool";

/** A usage window of a subscription. `other` is a window that Eva does not know yet. */
export type UsageWindow = "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "overage" | "other";

/** A multiple-choice question of the model to the person, such as Claude Code's AskUserQuestion. */
export interface ApprovalQuestion {
  readonly question: string;
  /** A short label for a chip, such as "Format". */
  readonly header: string;
  readonly options: readonly { readonly label: string; readonly description: string }[];
  /** True when the person may pick more than one option. */
  readonly multiSelect: boolean;
}

/**
 * The person's answer to one question: the indexes of the picked options, or the person's own text.
 * Indexes, not labels: the front ends see redacted labels, and the model must get the original ones.
 */
export interface QuestionAnswer {
  readonly selected: readonly number[];
  /** The person's own text. It wins over the selected options. */
  readonly other?: string;
}

/** One answer for each question, in the same order. */
export type QuestionAnswers = readonly QuestionAnswer[];

export type EngineEventPayload =
  | { readonly kind: "text"; readonly text: string; readonly messageId: string }
  /**
   * A piece of the text block that the engine writes now. The block's `text` event replaces the
   * pieces. So the core sends the pieces but never stores them (issue 117).
   */
  | {
      readonly kind: "text_delta";
      readonly text: string;
      /**
       * The first piece of a new block. A model call that failed and runs again starts a new
       * block before any final text, so each reader drops the pieces before this one.
       */
      readonly startsBlock?: true;
    }
  | {
      readonly kind: "tool_started";
      readonly toolUseId: string;
      readonly name: string;
      readonly category: ToolCategory;
      readonly summary: string;
      /** The whole input as JSON text, for the step dialog. An older Eva sends none. */
      readonly input?: string;
    }
  | {
      readonly kind: "tool_finished";
      readonly toolUseId: string;
      readonly isError: boolean;
      /** The whole output as text, for the step dialog. An older Eva sends none. */
      readonly output?: string;
    }
  | { readonly kind: "task_changed"; readonly taskId: string; readonly description: string; readonly state: TaskState }
  | {
      readonly kind: "approval_needed";
      readonly requestId: string;
      readonly toolName: string;
      readonly summary: string;
      /** The model's questions: the person answers them, and allows or denies nothing. An older Eva sends none. */
      readonly questions?: readonly ApprovalQuestion[];
    }
  /** The first answer to an approval won; every other front end closes its question. */
  | {
      readonly kind: "approval_resolved";
      readonly requestId: string;
      readonly answer: "allow" | "deny";
      /** True when nobody answered in time and the core denied it. */
      readonly timedOut: boolean;
      /** The person's answers to the questions, so every front end shows them. */
      readonly answers?: QuestionAnswers;
    }
  | { readonly kind: "history_lost" }
  /**
   * The chat has a new title; front ends show it, and Telegram renames the chat's topic.
   * `automatic`: a model named the chat, not the person (issue 50). An older event has no field.
   */
  | { readonly kind: "session_renamed"; readonly title: string; readonly automatic?: true }
  /** The person gave a fork its own name (issue 637). Only the web app shows it. */
  | { readonly kind: "fork_named"; readonly name: string }
  /** The person saw the first `seenTurns` turns of the chat in the web app (issue 381). */
  | { readonly kind: "session_seen"; readonly seenTurns: number }
  /** The person archived the chat, or brought it back to the chat list (issue 388). */
  | { readonly kind: "session_archived"; readonly archived: boolean }
  /** Eva closed the chat to reuse its clone. It keeps its history, but takes no message (issue 521). */
  | { readonly kind: "session_closed" }
  | { readonly kind: "notice"; readonly text: string }
  /** The subscription is near the limit of a usage window, or past it, so the engine refused the turn. */
  | {
      readonly kind: "usage_limit";
      readonly status: "warning" | "rejected";
      readonly window: UsageWindow;
      /** A whole percent of the window, or null when the engine does not say. */
      readonly usedPercent: number | null;
      /** An ISO time, or null when the engine does not say. */
      readonly resetsAt: string | null;
    }
  | {
      readonly kind: "turn_finished";
      readonly engineSessionId: string;
      readonly lastMessageId: string | null;
      /** The sum over every model call of the turn. */
      readonly usage: TurnUsage;
      readonly costUsd: number | null;
      /** The input tokens of the turn's last top-level model call: the context before the last answer. */
      readonly contextTokens: number | null;
      /** The size of the context window of the model that answered, or null when the engine does not say. */
      readonly contextWindow: number | null;
      /** The id of the model that answered, such as `claude-opus-5-5`, or null when the engine does not say. */
      readonly model: string | null;
    }
  | {
      readonly kind: "turn_failed";
      readonly reason: string;
      /** The engine's login no longer works, so the person must log in again. An older event has no field. */
      readonly loginExpired?: true;
    };

/**
 * Who sent a message to a chat: Telegram, a client of the local API (the web app or `eva chat`),
 * a schedule's prompt, or Eva herself (project work and its report).
 */
export type MessageOrigin = "telegram" | "api" | "schedule" | "eva";

/** What the core itself says about a chat. No engine sends these, so they stay off the engine port. */
export type CoreEventPayload =
  /** A message, when its turn starts, so a front end can show a message that another one sent. */
  | {
      readonly kind: "message_received";
      readonly text: string;
      readonly origin: MessageOrigin;
      /** A project work result, so a front end can show a summary instead of the raw text. Already redacted. */
      readonly projectReport?: ProjectReport;
    }
  /**
   * The chat is gone from the list; each front end drops its own view of it. After the delete of one
   * branch, `heirId` names the fork that took its place (issue 647), so a front end shows that one.
   */
  | { readonly kind: "session_deleted"; readonly heirId?: string }
  /** The chat gave work to a project: the Project chat that runs it. */
  | {
      readonly kind: "project_work_started";
      readonly projectId: string;
      readonly projectSessionId: string;
      readonly request: string;
    };

/** A payload as a front end receives it. */
export type SessionEvent = (EngineEventPayload | CoreEventPayload) & {
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
