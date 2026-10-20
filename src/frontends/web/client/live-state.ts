/** What the web UI learns from the event stream while turns run. */
import type { TaskSnapshot } from "../../../core/sessions/session-manager.ts";
import type { SessionEvent } from "../../../shared/events.ts";
import { addStep, type TurnStep } from "../../../shared/turn-steps.ts";
import type { UsageLimit } from "../../../shared/usage-limit.ts";

export interface LiveState {
  /** The steps of each running turn so far, by session id. A key means that a turn runs. */
  readonly steps: Readonly<Record<string, readonly TurnStep[]>>;
  /** The background tasks of the running turns, by task id. A task ends with its turn. */
  readonly tasks: Readonly<Record<string, { description: string; state: string; sessionId: string }>>;
  /** The `seq` of the last task event or turn end of each chat, by session id, from the current connection. */
  readonly taskSeqs: Readonly<Record<string, number>>;
  /**
   * The last usage limit of each chat, by session id. It outlives its turn, because a refused
   * turn ends at once and the person still needs the reset time.
   */
  readonly usageLimits: Readonly<Record<string, UsageLimit>>;
  /**
   * The notices of each chat's last turn, such as an MCP server that did not start, by session id.
   * They outlive the turn, because a short turn ends before the person reads them.
   */
  readonly notes: Readonly<Record<string, readonly string[]>>;
  /** The text of the block that the engine writes now, by session id. It is live only: the core never stores it. */
  readonly drafts: Readonly<Record<string, string>>;
}

export const emptyLiveState: LiveState = {
  steps: {},
  tasks: {},
  taskSeqs: {},
  usageLimits: {},
  notes: {},
  drafts: {},
};

const historyLostNote = "The earlier history of this chat is lost.";

/**
 * The state with the core's tasks, read after a reload or a reconnect, in place of the ones this
 * page knew. The reply and the events travel apart. So a chat with an event newer than the reply
 * keeps the tasks that this page knows: the reply could bring back a task that already ended.
 */
export function withTasks(state: LiveState, snapshot: TaskSnapshot): LiveState {
  const isNewer = (sessionId: string): boolean => (state.taskSeqs[sessionId] ?? 0) > snapshot.seq;
  const tasks: Record<string, LiveState["tasks"][string]> = {};
  for (const [taskId, task] of Object.entries(state.tasks)) if (isNewer(task.sessionId)) tasks[taskId] = task;
  for (const { taskId, sessionId, description, state: taskState } of snapshot.tasks) {
    if (!isNewer(sessionId)) tasks[taskId] = { description, state: taskState, sessionId };
  }
  return { ...state, tasks };
}

/**
 * A new connection starts the comparison again. Eva may have restarted, and her `seq` then
 * starts again at 1, so an older number would hide each later snapshot.
 */
export function forgetTaskEvents(state: LiveState): LiveState {
  return { ...state, taskSeqs: {} };
}

/** The state after one event. An event that changes nothing returns the same state, so React skips a render. */
export function applyEvent(state: LiveState, event: SessionEvent): LiveState {
  if (event.kind === "text_delta") return applyToDraft(state, event);
  return applyToTurn(applyToNotes(applyToDraft(state, event), event), event);
}

/**
 * The pieces of a block build its draft. The block's final text, the turn end or a delete drops it.
 * A turn whose first event is a piece runs too, so the piece also opens the turn's steps.
 */
function applyToDraft(state: LiveState, event: SessionEvent): LiveState {
  const id = event.sessionId;
  if (event.kind === "text_delta") {
    return {
      ...state,
      drafts: { ...state.drafts, [id]: (state.drafts[id] ?? "") + event.text },
      steps: id in state.steps ? state.steps : { ...state.steps, [id]: [] },
    };
  }
  const ends =
    event.kind === "text" ||
    event.kind === "turn_finished" ||
    event.kind === "turn_failed" ||
    event.kind === "session_deleted";
  if (!ends || !(id in state.drafts)) return state;
  const drafts = { ...state.drafts };
  Reflect.deleteProperty(drafts, id);
  return { ...state, drafts };
}

/** A notice is no step: the answer must stay the last message, and the whole answer must not hold it. */
function applyToNotes(state: LiveState, event: SessionEvent): LiveState {
  const id = event.sessionId;
  if (event.kind === "notice") {
    const current = state.notes[id] ?? [];
    // A follow-up turn starts with no message_received, so it can send the same notice again.
    if (current.includes(event.text)) return state;
    return { ...state, notes: { ...state.notes, [id]: [...current, event.text] } };
  }
  // A new turn brings its own notices.
  if ((event.kind === "message_received" || event.kind === "session_deleted") && id in state.notes) {
    const notes = { ...state.notes };
    Reflect.deleteProperty(notes, id);
    return { ...state, notes };
  }
  return state;
}

function applyToTurn(state: LiveState, event: SessionEvent): LiveState {
  if (event.kind === "usage_limit") {
    const { sessionId, seq: _seq, at: _at, ...limit } = event;
    return { ...state, usageLimits: { ...state.usageLimits, [sessionId]: limit } };
  }
  // Only a deleted chat drops its line. The engine may not repeat a limit at each turn, so the
  // line stays until a newer limit replaces it, and the chat hides it once its window resets.
  if (event.kind === "session_deleted" && event.sessionId in state.usageLimits) {
    const usageLimits = { ...state.usageLimits };
    Reflect.deleteProperty(usageLimits, event.sessionId);
    return { ...state, usageLimits };
  }
  // The core's own events are no step of a turn: the list shows their effect after a reload.
  if (event.kind === "message_received" || event.kind === "session_deleted" || event.kind === "project_work_started")
    return state;
  if (event.kind === "turn_finished" || event.kind === "turn_failed") {
    // The engine process ends with the turn, so its tasks end too. The turn's steps keep them.
    const steps = { ...state.steps };
    Reflect.deleteProperty(steps, event.sessionId);
    const tasks = Object.fromEntries(
      Object.entries(state.tasks).filter(([, task]) => task.sessionId !== event.sessionId),
    );
    // Each turn end counts, also with no task here: a late snapshot may still hold its tasks.
    return { ...state, steps, tasks, taskSeqs: { ...state.taskSeqs, [event.sessionId]: event.seq } };
  }
  const tasks =
    event.kind === "task_changed"
      ? {
          ...state.tasks,
          [event.taskId]: { description: event.description, state: event.state, sessionId: event.sessionId },
        }
      : state.tasks;
  const taskSeqs = event.kind === "task_changed" ? { ...state.taskSeqs, [event.sessionId]: event.seq } : state.taskSeqs;
  const current = state.steps[event.sessionId] ?? [];
  const next =
    event.kind === "history_lost"
      ? [...current, { kind: "message" as const, text: historyLostNote, isError: false, id: null }]
      : addStep(current, event);
  if (next === current && tasks === state.tasks) return state;
  return {
    ...state,
    tasks,
    taskSeqs,
    steps: next === current ? state.steps : { ...state.steps, [event.sessionId]: next },
  };
}

/** The steps of a running turn, with its draft as the last message, so the answer shows the words as they come. */
export function stepsWithDraft(steps: readonly TurnStep[], draft: string | undefined): readonly TurnStep[] {
  if (draft === undefined || draft === "") return steps;
  return [...steps, { kind: "message", text: draft, isError: false, id: null }];
}
