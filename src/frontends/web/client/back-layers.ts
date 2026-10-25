/**
 * The Back button of a phone closes the top layer first: the chat list over a chat, a dialog, a
 * sheet or a menu. Each open layer adds a history entry, and Back takes that entry away again.
 * A move to another address goes through this file too. A step back runs in the background, so
 * the next change of the history waits for it: otherwise the step lands on the wrong entry.
 */
import { hasUnsavedChanges } from "./leave-guard.ts";

/** The parts of `window` that the layers use. */
export interface LayerWindow {
  addEventListener(type: string, listener: (event: Event) => void): void;
  readonly location: { hash: string };
  readonly history: {
    readonly state: unknown;
    pushState(data: unknown, unused: string): void;
    replaceState(data: unknown, unused: string, url?: string): void;
    go(delta: number): void;
  };
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface LayerHandle {
  /** The page closed the layer, such as with its Close button: its entry goes away. */
  readonly close: () => void;
}

interface Layer {
  readonly key: string;
  readonly onBack: () => void;
  /** "waiting" until the history is free, "gone" after Back, a close or a new address. */
  state: "waiting" | "open" | "gone";
}

/** The keys of the open layers of an entry, bottom first. */
const layersKey = "evaLayers";
/** The address of the entry before, so a back arrow can step back to it. */
const fromKey = "evaFrom";
/** A step that never arrives, such as at the first entry, must not stop the history for good. */
const stepLimitMs = 1_000;

let target: LayerWindow | null = null;
/** The open layers that have an entry, bottom first. */
const open: Layer[] = [];
const restorers = new Map<string, () => void>();
let stepping = false;
let stepTimer: unknown = null;
const waiting: (() => void)[] = [];

function stateOf(window: LayerWindow): Record<string, unknown> {
  const { state } = window.history;
  return typeof state === "object" && state !== null ? (state as Record<string, unknown>) : {};
}

function stackOf(window: LayerWindow): readonly string[] {
  const stack = stateOf(window)[layersKey];
  return Array.isArray(stack) ? stack.filter((key): key is string => typeof key === "string") : [];
}

/** Runs the change now, or after the step that runs. */
function whenFree(change: (window: LayerWindow) => void): void {
  const window = target;
  if (window === null) return;
  if (stepping) waiting.push(() => change(window));
  else change(window);
}

/** A function, not the variable: a change that runs can start a step, and the checker cannot see it. */
function isStepping(): boolean {
  return stepping;
}

function step(window: LayerWindow, delta: number): void {
  stepping = true;
  window.history.go(delta);
  stepTimer = window.setTimeout(() => {
    stepTimer = null;
    free();
  }, stepLimitMs);
}

function free(): void {
  stepping = false;
  while (!isStepping() && waiting.length > 0) waiting.shift()?.();
}

/** Steps back over the entries of layers that are closed now. */
function dropExtraEntries(window: LayerWindow): void {
  const extra = stackOf(window).length - open.length;
  if (extra > 0) step(window, -extra);
}

function arrive(window: LayerWindow): void {
  if (stepTimer !== null) window.clearTimeout(stepTimer);
  stepTimer = null;
  stepping = false;
  if (window.history.state === null) {
    // A new address, from a link or a tab. The layers keep their place on the screen, but the
    // entries are behind now, so Back goes to the page before.
    for (const layer of open.splice(0)) layer.state = "gone";
  } else {
    const stack = stackOf(window);
    let kept = 0;
    while (kept < open.length && open[kept]?.key === stack[kept]) kept += 1;
    for (const layer of open.splice(kept).reverse()) {
      layer.state = "gone";
      layer.onBack();
    }
    const closed = stack.slice(kept);
    if (closed.length > 0) {
      // Back to the chat list opens it again. A dialog does not open again, so Back skips its entry.
      // The unsaved changes guard steps the history too: no skip may run against it.
      if (closed.every((key) => restorers.has(key))) for (const key of closed) restorers.get(key)?.();
      else if (!hasUnsavedChanges()) step(window, -1);
    }
  }
  if (!isStepping()) free();
}

/** Call it once, before the first render. */
export function watchLayers(window: LayerWindow): void {
  target = window;
  open.length = 0;
  waiting.length = 0;
  stepping = false;
  // A reload drops each layer, but the entry keeps its state.
  if (stackOf(window).length > 0) window.history.replaceState({ ...stateOf(window), [layersKey]: [] }, "");
  window.addEventListener("popstate", () => arrive(window));
}

/**
 * Adds a history entry for a layer. Back calls `onBack`. When Back returns to the entry of a layer
 * that a restorer opens again, the layer takes that entry and adds none.
 */
export function openLayer(key: string, onBack: () => void): LayerHandle {
  const layer: Layer = { key, onBack, state: "waiting" };
  whenFree((window) => {
    if (layer.state !== "waiting") return;
    layer.state = "open";
    const depth = open.length;
    open.push(layer);
    if (stackOf(window)[depth] === key) return;
    window.history.pushState(
      { ...stateOf(window), [layersKey]: open.map((each) => each.key), [fromKey]: window.location.hash },
      "",
    );
  });
  return {
    close: () => {
      if (layer.state === "waiting") layer.state = "gone";
      if (layer.state !== "open") return;
      // A layer above it, such as the archived chats in the chat list, stays on the screen with no entry.
      for (const above of open.splice(open.indexOf(layer))) above.state = "gone";
      whenFree(dropExtraEntries);
    },
  };
}

/** The layers of the current entry, bottom first, such as the chat list that Back opened again. */
export function layersOfEntry(): readonly string[] {
  return target === null ? [] : stackOf(target);
}

/** Back to an entry of the layer `key` opens the layer again with `restore`. */
export function restoreLayer(key: string, restore: () => void): () => void {
  restorers.set(key, restore);
  return () => {
    if (restorers.get(key) === restore) restorers.delete(key);
  };
}

/**
 * Opens an address in a new entry, so Back returns to this one. The same address fires no
 * hashchange, so `onSame` runs instead, for a view that must show its page again.
 */
export function goTo(address: string, onSame?: () => void): void {
  whenFree((window) => {
    const from = window.location.hash;
    if (from === address) {
      onSame?.();
      return;
    }
    window.location.hash = address;
    window.history.replaceState({ ...stateOf(window), [fromKey]: from }, "");
  });
}

/**
 * Opens the page above this one, such as the project of a chat. When the person came from that
 * page, it steps back, so the history does not grow and Back leaves as the person expects.
 */
export function goUp(address: string, onSame?: () => void): void {
  whenFree((window) => {
    if (stateOf(window)[fromKey] === address && stackOf(window).length === 0) step(window, -1);
    else goTo(address, onSame);
  });
}

/** Gives this entry another address, such as when a link is used up. The views see no change. */
export function replaceAddress(address: string): void {
  whenFree((window) => window.history.replaceState(window.history.state, "", address));
}
