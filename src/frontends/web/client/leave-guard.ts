/**
 * Asks before the person leaves a page with unsaved changes. A form holds the guard while it
 * has a change. Each way out of a page asks first: a link inside the page, the main navigation,
 * the back button, a reload and a closed tab. The person then saves, discards or stays.
 */
import { useEffect, useRef } from "react";

interface Guard {
  /** True means that the save worked. */
  readonly save: () => Promise<boolean>;
}

const guards = new Set<Guard>();
/** The move that waits for the person's answer, or null. */
let waiting: (() => void) | null = null;
const listeners = new Set<() => void>();
/** True while a move that the person allowed runs, so it does not ask again. */
let passing = false;

function notify(): void {
  for (const listener of listeners) listener();
}

/** Holds a guard until the returned function runs. */
export function holdLeave(save: () => Promise<boolean>): () => void {
  const guard: Guard = { save };
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

export function hasUnsavedChanges(): boolean {
  return guards.size > 0;
}

/** Makes the move at once when nothing is unsaved. Otherwise the move waits for the person's answer. */
export function askToLeave(move: () => void): void {
  if (passing || guards.size === 0) {
    move();
    return;
  }
  waiting = move;
  notify();
}

/** True while a move waits for the person's answer. */
export function isAskingToLeave(): boolean {
  return waiting !== null;
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
  const move = waiting;
  if (move === null) return false;
  if (answer === "save") {
    for (const guard of [...guards]) {
      if (!(await guard.save())) {
        waiting = null;
        notify();
        return false;
      }
    }
  }
  waiting = null;
  notify();
  if (answer === "stay") return false;
  // The forms forget their changes only when they close, so the move must not ask again.
  guards.clear();
  passing = true;
  try {
    move();
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

/** Holds a guard while `unsaved` is true. The latest `save` runs, so it sees the latest values. */
export function useLeaveGuard(unsaved: boolean, save: () => Promise<boolean>): void {
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => (unsaved ? holdLeave(() => latest.current()) : undefined), [unsaved]);
}
