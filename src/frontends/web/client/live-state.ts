/** What the web UI learns from the event stream while turns run. */
import type { TaskSnapshot, TurnSnapshot } from "../../../core/sessions/session-manager.ts";
import type { SessionEvent } from "../../../shared/events.ts";
import { addNote, addStep, type TurnStep } from "../../../shared/turn-steps.ts";
import type { UsageLimit } from "../../../shared/usage-limit.ts";

export interface LiveState {
  /** The steps of each running turn so far, by session id. A key means that a turn runs. */
  readonly steps: Readonly<Record<string, readonly TurnStep[]>>;
  /** The background tasks of the running turns, by task id. A task ends with its turn. */
  readonly tasks: Readonly<
    Record<string, { description: string; state: string; sessionId: string; chatId?: string | undefined }>
  >;
  /** The `seq` of the last task event or turn end of each chat, by session id, from the current connection. */
  readonly taskSeqs: Readonly<Record<string, number>>;
  /**
   * The last usage limit of each chat, by session id. It outlives its turn, because a refused
   * turn ends at once and the person still needs the reset time.
   */
  readonly usageLimits: Readonly<Record<string, UsageLimit>>;
  /**
   * The notes of each running turn, such as an MCP server that did not start, by session id. At
   * the turn end, the stored turn shows them.
   */
  readonly notes: Readonly<Record<string, readonly string[]>>;
  /** The text of the block that the engine writes now, by session id. It is live only: the core never stores it. */
  readonly drafts: Readonly<Record<string, string>>;
  /**
   * While the page reads the running turns again: the id of the newest read, and each event that
   * came since it started. Null when no read is open.
   */
  readonly recovery: { readonly id: number; readonly events: readonly SessionEvent[] } | null;
  /**
   * The fork that took the place of each deleted branch, by the deleted id (issue 647). A page that
   * showed the branch shows the fork instead.
   */
  readonly heirs: Readonly<Record<string, string>>;
}

export const emptyLiveState: LiveState = {
  steps: {},
  tasks: {},
  taskSeqs: {},
  usageLimits: {},
  notes: {},
  drafts: {},
  recovery: null,
  heirs: {},
};

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

/**
 * Starts a read of the running turns, with a new id. The steps stay until the reply, so the
 * answer does not blink. The page keeps each later event, because the reply and the events
 * travel apart. A newer read replaces an older one: its snapshot is newer, also after a restart
 * of Eva, whose `seq` then starts again.
 */
export function startRecovery(state: LiveState, id: number): LiveState {
  return { ...state, recovery: { id, events: [] } };
}

/**
 * Ends the read with this id. The steps and drafts of the core replace the ones that this page
 * knew, and the kept events newer than the snapshot apply again on top of them (lesson 83). With
 * no snapshot, as after a failed read, the page knows only the kept events. The reply of a read
 * that a newer one replaced changes nothing.
 */
export function withRunningTurns(state: LiveState, id: number, snapshot: TurnSnapshot | null): LiveState {
  if (state.recovery?.id !== id) return state;
  const { events } = state.recovery;
  const newer = snapshot === null ? events : events.filter((event) => event.seq > snapshot.seq);
  const turns = snapshot?.turns ?? [];
  const fromCore = Object.fromEntries(turns.map((turn) => [turn.sessionId, turn.steps]));
  // An older Eva sends no draft.
  const draftsFromCore = Object.fromEntries(
    turns.flatMap((turn) => (turn.draft === undefined || turn.draft === "" ? [] : [[turn.sessionId, turn.draft]])),
  );
  return {
    ...state,
    steps: newer.reduce(stepsAfter, fromCore),
    drafts: newer.reduce(draftsAfter, draftsFromCore),
    recovery: null,
  };
}

/**
 * Why the read of the running turns gave no snapshot. `no_route`: an older Eva has no such route.
 * `failed`: the network failed or was slow. `running` lists the chats that a fresh chat list says
 * still run, or is null when that list failed too.
 */
export type TurnsReadFailure =
  { readonly kind: "no_route" } | { readonly kind: "failed"; readonly running: readonly string[] | null };

/**
 * Ends the read with this id when it gave no snapshot. A failed read says nothing about the turns,
 * so the page keeps the steps that it applied event by event. But the page can have missed the
 * end of a turn while it slept: a chat that no longer runs drops its steps, or it shows as working
 * for good.
 */
export function afterFailedTurnsRead(state: LiveState, id: number, failure: TurnsReadFailure): LiveState {
  if (failure.kind === "no_route") return withRunningTurns(state, id, null);
  if (state.recovery?.id !== id) return state;
  const { running } = failure;
  if (running === null) return { ...state, recovery: null };
  const stillRuns = <Value>(entries: Record<string, Value>): Record<string, Value> =>
    Object.fromEntries(Object.entries(entries).filter(([sessionId]) => running.includes(sessionId)));
  return { ...state, steps: stillRuns(state.steps), drafts: stillRuns(state.drafts), recovery: null };
}

/** The state after one event. An event that changes nothing returns the same state, so React skips a render. */
export function applyEvent(state: LiveState, event: SessionEvent): LiveState {
  const drafts = draftsAfter(state.drafts, event);
  const withHeir =
    event.kind === "session_deleted" && event.heirId !== undefined
      ? { ...state, heirs: { ...state.heirs, [event.sessionId]: event.heirId } }
      : state;
  const withDraft = drafts === state.drafts ? withHeir : { ...withHeir, drafts };
  const next = applyToTurn(applyToNotes(withDraft, event), event);
  if (next.recovery === null) return next;
  return { ...next, recovery: { ...next.recovery, events: [...next.recovery.events, event] } };
}

/**
 * The draft of each chat after one event. The pieces of a block build its draft. A new block,
 * the block's final text, the turn end or a delete drops it.
 */
function draftsAfter(drafts: LiveState["drafts"], event: SessionEvent): LiveState["drafts"] {
  const id = event.sessionId;
  if (event.kind === "text_delta") {
    return { ...drafts, [id]: (event.startsBlock === true ? "" : (drafts[id] ?? "")) + event.text };
  }
  const ends =
    event.kind === "text" ||
    event.kind === "turn_finished" ||
    event.kind === "turn_failed" ||
    event.kind === "session_deleted";
  if (!ends || !(id in drafts)) return drafts;
  const rest = { ...drafts };
  Reflect.deleteProperty(rest, id);
  return rest;
}

/** The steps of the running turns after one event. A key means that a turn runs. */
function stepsAfter(steps: LiveState["steps"], event: SessionEvent): LiveState["steps"] {
  // The core's own events are no step of a turn: the list shows their effect after a reload.
  if (event.kind === "session_deleted") return steps;
  // Project work is a task of the turn whose shell started it. Without a running turn, no turn starts here.
  if (event.kind === "project_work_started") {
    const running = steps[event.sessionId];
    return running === undefined ? steps : { ...steps, [event.sessionId]: addStep(running, event) };
  }
  // The core sends the message when the turn starts. The engine can then think for seconds with no
  // step, and a message sent in that time must join the next turn, so the turn runs from here.
  // A turn whose first event is a piece or a note runs too, such as a turn that waits for another chat in its clone.
  if (
    event.kind === "message_received" ||
    event.kind === "text_delta" ||
    event.kind === "notice" ||
    event.kind === "history_lost"
  )
    return event.sessionId in steps ? steps : { ...steps, [event.sessionId]: [] };
  if (event.kind === "turn_finished" || event.kind === "turn_failed") {
    if (!(event.sessionId in steps)) return steps;
    const rest = { ...steps };
    Reflect.deleteProperty(rest, event.sessionId);
    return rest;
  }
  const current = steps[event.sessionId] ?? [];
  const next = addStep(current, event);
  return next === current ? steps : { ...steps, [event.sessionId]: next };
}

/** The notes of each running turn. The stored turn keeps them, so they end with the turn (issue 157). */
function applyToNotes(state: LiveState, event: SessionEvent): LiveState {
  const id = event.sessionId;
  if (event.kind === "notice" || event.kind === "history_lost") {
    const current = state.notes[id] ?? [];
    const next = addNote(current, event);
    return next === current ? state : { ...state, notes: { ...state.notes, [id]: next } };
  }
  const ends = event.kind === "turn_finished" || event.kind === "turn_failed" || event.kind === "session_deleted";
  if (!ends || !(id in state.notes)) return state;
  const notes = { ...state.notes };
  Reflect.deleteProperty(notes, id);
  return { ...state, notes };
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
  const steps = stepsAfter(state.steps, event);
  if (event.kind === "turn_finished" || event.kind === "turn_failed") {
    // The engine process ends with the turn, so its tasks end too. The turn's steps keep them.
    const tasks = Object.fromEntries(
      Object.entries(state.tasks).filter(([, task]) => task.sessionId !== event.sessionId),
    );
    // Each turn end counts, also with no task here: a late snapshot may still hold its tasks.
    return { ...state, steps, tasks, taskSeqs: { ...state.taskSeqs, [event.sessionId]: event.seq } };
  }
  if (event.kind !== "task_changed") return steps === state.steps ? state : { ...state, steps };
  const task = { description: event.description, state: event.state, sessionId: event.sessionId };
  return {
    ...state,
    steps,
    tasks: { ...state.tasks, [event.taskId]: task },
    taskSeqs: { ...state.taskSeqs, [event.sessionId]: event.seq },
  };
}

/** The steps of a running turn, with its draft as the last message, so the answer shows the words as they come. */
export function stepsWithDraft(steps: readonly TurnStep[], draft: string | undefined): readonly TurnStep[] {
  if (draft === undefined || draft.trim() === "") return steps;
  return [...steps, { kind: "message", text: draft, isError: false, id: null }];
}

/** The id that a branch has now: the fork that took its place, through every later delete (issue 647). */
export function latestId(sessionId: string, heirs: LiveState["heirs"]): string {
  let id = sessionId;
  // The bound stops a loop, which only a damaged list of events could hold.
  for (let step = 0; step < 100; step += 1) {
    const heir = heirs[id];
    if (heir === undefined) return id;
    id = heir;
  }
  return id;
}
