/**
 * The steps of one turn: each message, command, tool and background task, in order. The
 * session manager stores them and the web app builds them live, both with this one reducer,
 * so a running answer and a stored answer show the same badges.
 */
import type { EngineEventPayload } from "./events.ts";

/** Stored names: renaming a kind needs a tolerant read of the old one. The session store reads this list. */
export const stepKinds = ["message", "command", "tool", "task"] as const;
export type StepKind = (typeof stepKinds)[number];

export interface TurnStep {
  readonly kind: StepKind;
  readonly text: string;
  readonly isError: boolean;
  /** The message, tool use or task id, so a later event can find its step. */
  readonly id: string | null;
}

/** Long enough for a hover. The web app fetches the steps of the recent turns after each turn. */
const stepTextLength = 200;
const maxStoredSteps = 100;

/**
 * Adds the step of one event. Every step but a message is cut at once, so a tool with a huge
 * input never fills the memory of a long turn. Call it with redacted payloads only: a cut
 * before the redaction could split a secret that the redactor then misses (lesson 95).
 */
export function addStep(steps: readonly TurnStep[], payload: EngineEventPayload): readonly TurnStep[] {
  switch (payload.kind) {
    case "text":
      return [...steps, { kind: "message", text: payload.text, isError: false, id: payload.messageId }];
    case "tool_started": {
      // A summary in JSON has no tool name, and the step list shows the name as its action.
      const text = payload.summary.startsWith("{") ? `${payload.name} ${payload.summary}` : payload.summary;
      const step = { kind: payload.category, text: shortened(text), isError: false, id: payload.toolUseId };
      return [...steps, step];
    }
    case "tool_finished":
      return payload.isError ? markError(steps, payload.toolUseId, ["command", "tool"]) : steps;
    case "task_changed": {
      // A task sends an event at each state change, but it is one step.
      const known = steps.some((step) => step.kind === "task" && step.id === payload.taskId);
      const withTask: readonly TurnStep[] = known
        ? steps
        : [...steps, { kind: "task", text: shortened(payload.description), isError: false, id: payload.taskId }];
      return payload.state === "failed" ? markError(withTask, payload.taskId, ["task"]) : withTask;
    }
    default:
      return steps;
  }
}

/** The answer shows its last message in full, with the other steps as badges before and after it. */
export function splitSteps(steps: readonly TurnStep[]): {
  before: readonly TurnStep[];
  lastMessage: TurnStep | undefined;
  after: readonly TurnStep[];
} {
  const last = steps.findLastIndex((step) => step.kind === "message");
  if (last === -1) return { before: steps, lastMessage: undefined, after: [] };
  return { before: steps.slice(0, last), lastMessage: steps[last], after: steps.slice(last + 1) };
}

/**
 * The steps to keep: the last message in full, because the answer shows it, and short texts
 * for the badges. Only the last 100 steps stay, but the last message always stays.
 */
export function storedSteps(steps: readonly TurnStep[]): { steps: TurnStep[]; omittedSteps: number } {
  const lastMessage = steps.findLastIndex((step) => step.kind === "message");
  const firstKept = Math.max(0, steps.length - maxStoredSteps);
  const kept = steps
    .map((step, index) => ({ step, index }))
    .filter(({ index }) => index >= firstKept || index === lastMessage)
    .map(({ step, index }) => (index === lastMessage ? step : { ...step, text: shortened(step.text) }));
  return { steps: kept, omittedSteps: steps.length - kept.length };
}

function markError(steps: readonly TurnStep[], id: string, kinds: readonly StepKind[]): readonly TurnStep[] {
  const matches = (step: TurnStep): boolean => step.id === id && kinds.includes(step.kind);
  if (!steps.some(matches)) return steps;
  return steps.map((step) => (matches(step) ? { ...step, isError: true } : step));
}

/** Cuts by characters, not UTF-16 units, so an emoji is never split. */
function shortened(text: string): string {
  const characters = Array.from(text);
  return characters.length <= stepTextLength ? text : `${characters.slice(0, stepTextLength - 1).join("")}…`;
}
