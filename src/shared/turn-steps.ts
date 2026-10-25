/**
 * The steps of one turn: each message, command, tool and background task, in order. The
 * session manager stores them and the web app builds them live, both with this one reducer,
 * so a running answer and a stored answer show the same badges.
 */
import type { CoreEventPayload, EngineEventPayload } from "./events.ts";

/** Stored names: renaming a kind needs a tolerant read of the old one. The session store reads this list. */
export const stepKinds = ["message", "command", "tool", "task"] as const;
export type StepKind = (typeof stepKinds)[number];

export interface TurnStep {
  readonly kind: StepKind;
  readonly text: string;
  readonly isError: boolean;
  /** The message, tool use or task id, so a later event can find its step. */
  readonly id: string | null;
  /** The whole input of a tool, for the step dialog. The session record keeps it in its own file. */
  readonly input?: string;
  /** The whole output of a tool, for the step dialog. */
  readonly output?: string;
  /** The chat that a task runs in, such as the Project chat of project work, so the answer can open it. */
  readonly chatId?: string | undefined;
}

type ProjectWorkStarted = Extract<CoreEventPayload, { kind: "project_work_started" }>;

/** The input and output of a step. */
export interface StepDetail {
  readonly input?: string | undefined;
  readonly output?: string | undefined;
}

export interface StepDetailWithId extends StepDetail {
  readonly id: string;
}

/** Long enough for a hover. The web app fetches the steps of the recent turns after each turn. */
const stepTextLength = 200;
const maxStoredSteps = 100;

/**
 * Adds the step of one event. The text of every step but a message is cut at once. A tool's
 * input and output stay whole, because the core already bounds them. Call it with redacted
 * payloads only: a cut before the redaction could split a secret that the redactor then misses (lesson 95).
 */
export function addStep(
  steps: readonly TurnStep[],
  payload: EngineEventPayload | ProjectWorkStarted,
): readonly TurnStep[] {
  switch (payload.kind) {
    case "project_work_started": {
      const chatId = payload.projectSessionId;
      const text = shortened(`${payload.projectId}: ${payload.request}`);
      return [...steps, { kind: "task", text, isError: false, id: chatId, chatId }];
    }
    case "text":
      return [...steps, { kind: "message", text: payload.text, isError: false, id: payload.messageId }];
    case "tool_started": {
      // A summary in JSON has no tool name, and the step list shows the name as its action.
      const text = payload.summary.startsWith("{") ? `${payload.name} ${payload.summary}` : payload.summary;
      const step = {
        kind: payload.category,
        text: shortened(text),
        isError: false,
        id: payload.toolUseId,
        ...(payload.input === undefined ? {} : { input: payload.input }),
      };
      return [...steps, step];
    }
    case "tool_finished": {
      const { output } = payload;
      const withOutput =
        output === undefined ? steps : changeStep(steps, payload.toolUseId, ["command", "tool"], { output });
      return payload.isError ? markError(withOutput, payload.toolUseId, ["command", "tool"]) : withOutput;
    }
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

export const historyLostNote = "The earlier history of this chat is lost.";

/**
 * Adds the note of one event, such as an MCP server that did not start. A note is no step: the
 * answer must stay the last message, and the whole answer must not hold it (issue 157).
 */
export function addNote(notes: readonly string[], payload: EngineEventPayload): readonly string[] {
  const note = payload.kind === "notice" ? payload.text : payload.kind === "history_lost" ? historyLostNote : null;
  // The same notice twice tells the person nothing new.
  return note === null || notes.includes(note) ? notes : [...notes, note];
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

/** A step without its details: the session list stays small, and the details file keeps them. */
export function withoutDetails(step: TurnStep): TurnStep {
  const { input: _input, output: _output, ...rest } = step;
  return rest;
}

/** The details of each step that has some, with its id. */
export function stepDetails(steps: readonly TurnStep[]): StepDetailWithId[] {
  return steps.flatMap(({ id, input, output }) =>
    id === null || (input === undefined && output === undefined)
      ? []
      : [{ id, ...(input === undefined ? {} : { input }), ...(output === undefined ? {} : { output }) }],
  );
}

function markError(steps: readonly TurnStep[], id: string, kinds: readonly StepKind[]): readonly TurnStep[] {
  return changeStep(steps, id, kinds, { isError: true });
}

function changeStep(
  steps: readonly TurnStep[],
  id: string,
  kinds: readonly StepKind[],
  change: Partial<TurnStep>,
): readonly TurnStep[] {
  const matches = (step: TurnStep): boolean => step.id === id && kinds.includes(step.kind);
  if (!steps.some(matches)) return steps;
  return steps.map((step) => (matches(step) ? { ...step, ...change } : step));
}

/** Cuts by characters, not UTF-16 units, so an emoji is never split. */
function shortened(text: string): string {
  const characters = Array.from(text);
  return characters.length <= stepTextLength ? text : `${characters.slice(0, stepTextLength - 1).join("")}…`;
}
