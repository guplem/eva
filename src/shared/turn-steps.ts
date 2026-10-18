/**
 * The steps of one turn: each message, command, tool and background task, in order. The
 * session manager stores them and the web app builds them live, both with this one reducer,
 * so a running answer and a stored answer show the same badges.
 */
import type { EngineEventPayload } from "./events.ts";

/** A stored name: renaming a kind needs a tolerant read of the old one. */
export type StepKind = "message" | "command" | "tool" | "task";

export interface TurnStep {
  readonly kind: StepKind;
  readonly text: string;
  readonly isError: boolean;
  /** The message, tool use or task id, so a later event can find its step. */
  readonly id: string | null;
}

/** Long enough for a hover; the whole session list goes to the web app after each turn. */
const stepTextLength = 200;
const maxStoredSteps = 100;

export function addStep(steps: readonly TurnStep[], payload: EngineEventPayload): readonly TurnStep[] {
  switch (payload.kind) {
    case "text":
      return [...steps, { kind: "message", text: payload.text, isError: false, id: payload.messageId }];
    case "tool_started":
      return [...steps, { kind: payload.category, text: payload.summary, isError: false, id: payload.toolUseId }];
    case "tool_finished":
      return payload.isError ? markError(steps, payload.toolUseId) : steps;
    case "task_changed": {
      // A task sends an event at each state change, but it is one step.
      const known = steps.some((step) => step.kind === "task" && step.id === payload.taskId);
      if (!known) {
        steps = [...steps, { kind: "task", text: payload.description, isError: false, id: payload.taskId }];
      }
      return payload.state === "failed" ? markError(steps, payload.taskId) : steps;
    }
    default:
      return steps;
  }
}

/**
 * The steps to store: the last message keeps its full text, because the answer shows it.
 * Every other step keeps a short text for its badge. Cut only redacted text, so a cut never
 * splits a secret that the redactor would then miss (lesson 95).
 */
export function storedSteps(steps: readonly TurnStep[]): { steps: TurnStep[]; omittedSteps: number } {
  const lastMessage = steps.findLastIndex((step) => step.kind === "message");
  const cut = steps.map((step, index) => (index === lastMessage ? step : { ...step, text: shortened(step.text) }));
  const omittedSteps = Math.max(0, cut.length - maxStoredSteps);
  return { steps: cut.slice(omittedSteps), omittedSteps };
}

function markError(steps: readonly TurnStep[], id: string): readonly TurnStep[] {
  return steps.map((step) => (step.id === id && step.kind !== "message" ? { ...step, isError: true } : step));
}

function shortened(text: string): string {
  return text.length <= stepTextLength ? text : `${text.slice(0, stepTextLength - 1)}…`;
}
