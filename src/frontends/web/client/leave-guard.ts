/**
 * Asks before the person loses unsaved changes. A form holds the guard while it has a change.
 * Each way out of a page asks first: a link inside the page, the main navigation, the back
 * button, a reload and a closed tab. A form can also ask about its own changes only, such as
 * when its dialog closes. The person then saves, discards or stays.
 */
/** The move that the question names, as in "Discard and close". */
export type LeaveMove = "leave" | "close" | "load again";

export interface LeaveQuestion {
  readonly move: LeaveMove;
  /** False when a form's save would create or act, such as a push: the question offers no save then. */
  readonly canSave: boolean;
}

interface Guard {
  /** True means that the save worked. Null when the form offers no save. */
  readonly save: (() => Promise<boolean>) | null;
}

export interface LeaveHold {
  readonly release: () => void;
  /** Asks about this guard only, then makes the move. With the guard released, the move runs at once. */
  readonly ask: (move: () => void, name: LeaveMove) => void;
}

interface Waiting {
  readonly move: () => void;
  readonly guards: readonly Guard[];
  readonly question: LeaveQuestion;
}

const guards = new Set<Guard>();
let waiting: Waiting | null = null;
const listeners = new Set<() => void>();
/** True while a move that the person allowed runs, so it does not ask again. */
let passing = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function ask(move: () => void, asked: readonly Guard[], name: LeaveMove): void {
  if (passing || asked.length === 0) {
    move();
    return;
  }
  waiting = { move, guards: asked, question: { move: name, canSave: asked.every((guard) => guard.save !== null) } };
  notify();
}

export function holdLeave(save: (() => Promise<boolean>) | null): LeaveHold {
  const guard: Guard = { save };
  guards.add(guard);
  return {
    release: () => {
      guards.delete(guard);
    },
    ask: (move, name) => ask(move, guards.has(guard) ? [guard] : [], name),
  };
}

export function hasUnsavedChanges(): boolean {
  return guards.size > 0;
}

/** Makes the move at once when nothing is unsaved. Otherwise the move waits for the person's answer. */
export function askToLeave(move: () => void): void {
  ask(move, [...guards], "leave");
}

export function isAskingToLeave(): boolean {
  return waiting !== null;
}

/** The open question, or null. The same object until the question changes, for `useSyncExternalStore`. */
export function leaveQuestion(): LeaveQuestion | null {
  return waiting?.question ?? null;
}

/** For `useSyncExternalStore`. */
export function subscribeToLeave(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The person's answer. Save makes the move only when every save worked: a failed save keeps
 * the page, and the form shows why. True means that the move ran.
 */
export async function answerLeave(answer: "save" | "discard" | "stay"): Promise<boolean> {
  const asked = waiting;
  if (asked === null) return false;
  if (answer === "save") {
    for (const guard of asked.guards) {
      if (guard.save === null || !(await guard.save())) {
        waiting = null;
        notify();
        return false;
      }
    }
  }
  waiting = null;
  notify();
  if (answer === "stay") return false;
  // Each form releases its guard when it closes or saves. A form that stays open keeps asking.
  passing = true;
  try {
    asked.move();
  } finally {
    passing = false;
  }
  return true;
}

/** The parts of `window` that the watch uses. */
export interface LeaveWindow {
  addEventListener(type: string, listener: (event: Event) => void): void;
  dispatchEvent(event: Event): boolean;
  readonly history: { replaceState(data: unknown, unused: string, url: string): void };
}

/**
 * Watches the address and the end of the page. Call it before the first render: the browser
 * runs the listeners in order, so this one stops a change before a view sees it.
 */
export function watchLeaving(target: LeaveWindow): void {
  target.addEventListener("hashchange", (event) => {
    if (passing || guards.size === 0) return;
    const { oldURL, newURL } = event as HashChangeEvent;
    // The back button cannot be stopped, so the old address comes back in place until the person answers.
    event.stopImmediatePropagation();
    target.history.replaceState(null, "", oldURL);
    askToLeave(() => {
      target.history.replaceState(null, "", newURL);
      target.dispatchEvent(new Event("hashchange"));
    });
  });
  // A reload or a closed tab would drop the changes, so the browser asks first.
  target.addEventListener("beforeunload", (event) => {
    if (guards.size > 0) event.preventDefault();
  });
}
