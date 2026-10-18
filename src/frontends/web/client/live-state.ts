/** What the web UI learns from the event stream while turns run. */
import type { SessionEvent } from "../../../shared/events.ts";
import { addStep, type TurnStep } from "../../../shared/turn-steps.ts";

export interface LiveState {
  /** The steps of each running turn so far, by session id. A key means that a turn runs. */
  readonly steps: Readonly<Record<string, readonly TurnStep[]>>;
  /** Background tasks by task id. */
  readonly tasks: Readonly<Record<string, { description: string; state: string; sessionId: string }>>;
}

export const emptyLiveState: LiveState = { steps: {}, tasks: {} };

const historyLostNote = "The earlier history of this chat is lost.";

/** The state after one event. An event that changes nothing returns the same state, so React skips a render. */
export function applyEvent(state: LiveState, event: SessionEvent): LiveState {
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
  return { tasks, steps: next === current ? state.steps : { ...state.steps, [event.sessionId]: next } };
}
