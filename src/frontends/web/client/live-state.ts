/** What the web UI learns from the event stream while turns run. */
import type { SessionEvent } from "../../../shared/events.ts";
import { addStep, type TurnStep } from "../../../shared/turn-steps.ts";
import type { UsageLimit } from "../../../shared/usage-limit.ts";

export interface LiveState {
  /** The steps of each running turn so far, by session id. A key means that a turn runs. */
  readonly steps: Readonly<Record<string, readonly TurnStep[]>>;
  /** Background tasks by task id. */
  readonly tasks: Readonly<Record<string, { description: string; state: string; sessionId: string }>>;
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
}

export const emptyLiveState: LiveState = { steps: {}, tasks: {}, usageLimits: {}, notes: {} };

const historyLostNote = "The earlier history of this chat is lost.";

/** The state after one event. An event that changes nothing returns the same state, so React skips a render. */
export function applyEvent(state: LiveState, event: SessionEvent): LiveState {
  return applyToTurn(applyToNotes(state, event), event);
}

/** A notice is no step: the answer must stay the last message, and the whole answer must not hold it. */
function applyToNotes(state: LiveState, event: SessionEvent): LiveState {
  const id = event.sessionId;
  if (event.kind === "notice")
    return { ...state, notes: { ...state.notes, [id]: [...(state.notes[id] ?? []), event.text] } };
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
    if (!(event.sessionId in state.steps)) return state;
    const steps = { ...state.steps };
    Reflect.deleteProperty(steps, event.sessionId);
    return { ...state, steps };
  }
  const tasks =
    event.kind === "task_changed"
      ? {
          ...state.tasks,
          [event.taskId]: { description: event.description, state: event.state, sessionId: event.sessionId },
        }
      : state.tasks;
  const current = state.steps[event.sessionId] ?? [];
  const next =
    event.kind === "history_lost"
      ? [...current, { kind: "message" as const, text: historyLostNote, isError: false, id: null }]
      : addStep(current, event);
  if (next === current && tasks === state.tasks) return state;
  return { ...state, tasks, steps: next === current ? state.steps : { ...state.steps, [event.sessionId]: next } };
}
