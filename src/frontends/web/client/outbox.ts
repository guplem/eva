/**
 * The messages that the page sent, until a stored turn shows them (#945). On a bad connection a
 * message stays in its chat with its state, and the page sends it again with the same id. The core
 * runs an id once, so a try whose answer got lost does not run the message twice.
 *
 * The messages of one chat go in order: a message waits behind an earlier message that Eva does not
 * have yet. When a message fails for good, the later messages of its chat fail with it, so the
 * person tries them again together and the order stays.
 */
import { ApiError } from "./request.ts";

/**
 * - `sending`: a try runs, or the message waits for an earlier message of its chat.
 * - `waiting`: the last try failed, and the next try waits.
 * - `failed`: the page stopped trying. The person tries again or edits the message.
 * - `sent`: Eva has the message. It shows until its stored turn comes.
 */
export type OutboxState = "sending" | "waiting" | "failed" | "sent";

export interface OutboxEntry {
  readonly sessionId: string;
  readonly text: string;
  /** The id that each try sends, so Eva runs the message once. */
  readonly id: string;
  /** The stored turn count that the message waits beyond, as `PendingMessage.turnCount`. */
  readonly turnCount: number;
  readonly state: OutboxState;
  /** Why Eva refused the message, or null when the connection failed. */
  readonly reason: string | null;
  /** True once a try failed, so a later try shows its state at once. */
  readonly retried: boolean;
}

export interface OutboxTimers {
  set(run: () => void, ms: number): unknown;
  clear(timer: unknown): void;
}

/** The part of the browser's `Storage` that the outbox uses. */
export type OutboxStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface OutboxOptions {
  /** `repeat`: a turn already holds the message, from a try whose answer got lost. */
  readonly send: (sessionId: string, text: string, id: string) => Promise<{ readonly repeat: boolean }>;
  readonly timers: OutboxTimers;
  /**
   * The tab's storage, so a reload keeps the messages (#946). A function, because the browser can
   * throw at the access itself. Without it, the outbox lives in memory only.
   */
  readonly storage?: () => OutboxStorage;
}

/** The wait before each new try. A phone often gets its network back within a minute. */
export const retryWaitsMs: readonly number[] = [2_000, 5_000, 15_000, 30_000, 60_000];

/** Why a message failed that waited behind a message that Eva refused. Its own connection was fine. */
export const earlierRefused = "An earlier message was not sent.";

/** The key of the outbox in the tab's storage. */
const storageKey = "eva-outbox";

const states: readonly string[] = ["sending", "waiting", "failed", "sent"] satisfies OutboxState[];

/** One stored entry, or null when the tab holds something else, such as a value of a broken write. */
function storedEntry(value: unknown): OutboxEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const { sessionId, text, id, turnCount, state, reason, retried } = value as Record<string, unknown>;
  if (typeof sessionId !== "string" || typeof text !== "string" || typeof id !== "string") return null;
  if (typeof turnCount !== "number" || !Number.isSafeInteger(turnCount)) return null;
  if (typeof state !== "string" || !states.includes(state)) return null;
  if (reason !== null && typeof reason !== "string") return null;
  if (typeof retried !== "boolean") return null;
  return { sessionId, text, id, turnCount, state: state as OutboxState, reason, retried };
}

/**
 * The entries that the tab kept before a reload. A try that ran at the reload has no answer, so its
 * message waits. The next connection sends it again with the same id, and Eva runs it once.
 */
function restoredEntries(storage: () => OutboxStorage): OutboxEntry[] {
  let kept: unknown;
  try {
    kept = JSON.parse(storage().getItem(storageKey) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(kept)) return [];
  return kept
    .map(storedEntry)
    .filter((entry) => entry !== null)
    .map((entry) => (entry.state === "sending" ? { ...entry, state: "waiting" } : entry));
}

/** True for a failure that a later try can fix: no network, no answer in time, or a fault on Eva's side. */
function canTryAgain(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status >= 500 || error.status === 408 || error.status === 429;
}

/** The reason of a message that fails with an earlier one: a refusal of the earlier one is not its own. */
function followerReason(earlierReason: string | null): string | null {
  return earlierReason === null ? null : earlierRefused;
}

interface Slot {
  entry: OutboxEntry;
  tries: number;
  inFlight: boolean;
  timer: unknown;
}

export class Outbox {
  private readonly options: OutboxOptions;
  private slots: Slot[] = [];
  private readonly listeners = new Set<() => void>();
  /** The list of each chat, built once for each change, so React sees the same list until a change. */
  private readonly lists = new Map<string, readonly OutboxEntry[]>();
  /** The turn count that a message sent now waits beyond, in each chat. The chat view tells it. */
  private readonly turnCounts = new Map<string, number>();

  constructor(options: OutboxOptions) {
    this.options = options;
    // Nothing sends here: the page may not be logged in yet. The first connection calls retryNow.
    if (options.storage !== undefined)
      this.slots = restoredEntries(options.storage).map((entry) => ({
        entry,
        tries: 0,
        inFlight: false,
        timer: null,
      }));
  }

  add(message: {
    readonly sessionId: string;
    readonly text: string;
    readonly id: string;
    readonly turnCount: number;
  }): void {
    const slot: Slot = {
      entry: { ...message, state: "sending", reason: null, retried: false },
      tries: 0,
      inFlight: false,
      timer: null,
    };
    // Behind a message that waits or failed, the new message waits or fails too, so the order stays.
    const earlier = this.headOf(message.sessionId);
    this.slots.push(slot);
    if (earlier?.entry.state === "waiting") this.set(slot, { state: "waiting" });
    if (earlier?.entry.state === "failed")
      this.set(slot, { state: "failed", reason: followerReason(earlier.entry.reason) });
    this.pump(message.sessionId);
    this.changed();
  }

  list(sessionId: string): readonly OutboxEntry[] {
    let list = this.lists.get(sessionId);
    if (list === undefined) {
      list = this.slots.filter((slot) => slot.entry.sessionId === sessionId).map((slot) => slot.entry);
      this.lists.set(sessionId, list);
    }
    return list;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The chat view tells the turn count that a message sent now would wait beyond. */
  noteTurnCount(sessionId: string, turnCount: number): void {
    this.turnCounts.set(sessionId, turnCount);
  }

  /** The network came back, or the page shows again: each waiting message tries at once. */
  retryNow(): void {
    const chats = new Set<string>();
    for (const slot of this.slots) {
      if (slot.entry.state !== "waiting") continue;
      this.stopTimer(slot);
      this.set(slot, { state: "sending" });
      chats.add(slot.entry.sessionId);
    }
    if (chats.size === 0) return;
    for (const chat of chats) this.pump(chat);
    this.changed();
  }

  /** The person tries a failed message again. The failed messages of its chat go again, in order. */
  retry(id: string): void {
    const sessionId = this.slots.find((slot) => slot.entry.id === id)?.entry.sessionId;
    if (sessionId === undefined) return;
    for (const slot of this.slots) {
      if (slot.entry.sessionId !== sessionId || slot.entry.state !== "failed") continue;
      slot.tries = 0;
      this.set(slot, { state: "sending", reason: null });
    }
    this.pump(sessionId);
    this.changed();
  }

  /**
   * The turns of a chat that started, with the client ids of their messages. A turn that holds a
   * message confirms it, even when the answer of its send got lost. The message then waits for the
   * stored turn of that turn, not for a later one.
   */
  confirm(
    sessionId: string,
    turns: readonly { readonly turnIndex: number; readonly clientIds: readonly string[] }[],
  ): void {
    let changed = false;
    for (const slot of this.slots) {
      if (slot.entry.sessionId !== sessionId) continue;
      const turn = turns.find((candidate) => candidate.clientIds.includes(slot.entry.id));
      if (turn === undefined || (slot.entry.state === "sent" && slot.entry.turnCount === turn.turnIndex)) continue;
      this.stopTimer(slot);
      this.set(slot, { state: "sent", reason: null, turnCount: turn.turnIndex });
      changed = true;
    }
    if (!changed) return;
    this.pump(sessionId);
    this.changed();
  }

  /** Drops the sent messages of a chat that its stored turns show now. An unsent message stays. */
  forget(sessionId: string, turnCount: number): void {
    const kept = this.slots.filter(
      (slot) => slot.entry.sessionId !== sessionId || slot.entry.state !== "sent" || slot.entry.turnCount >= turnCount,
    );
    if (kept.length === this.slots.length) return;
    this.slots = kept;
    this.changed();
  }

  /** Takes a message out, such as for an edit. The next message of its chat goes. */
  remove(id: string): OutboxEntry | undefined {
    const slot = this.slots.find((candidate) => candidate.entry.id === id);
    if (slot === undefined) return undefined;
    this.stopTimer(slot);
    this.slots = this.slots.filter((candidate) => candidate !== slot);
    this.pump(slot.entry.sessionId);
    this.changed();
    return slot.entry;
  }

  /** Starts a try of the first unsent message of a chat, when nothing holds it. */
  private pump(sessionId: string): void {
    const head = this.headOf(sessionId);
    if (head === undefined || head.inFlight) return;
    // A message that only waited behind an earlier one has no timer of its own: it goes now.
    if (head.entry.state === "waiting" && head.timer === null) {
      for (const slot of [head, ...this.laterOf(head)])
        if (slot.entry.state === "waiting") this.set(slot, { state: "sending" });
    }
    if (head.entry.state !== "sending") return;
    head.inFlight = true;
    head.tries += 1;
    const { text, id } = head.entry;
    this.options.send(sessionId, text, id).then(
      (answer) => this.answered(head, null, answer.repeat),
      (error: unknown) => this.answered(head, error, false),
    );
  }

  private answered(slot: Slot, error: unknown, repeat: boolean): void {
    slot.inFlight = false;
    // A confirm or a remove came first.
    if (slot.entry.state === "sent" || !this.slots.includes(slot)) {
      this.pump(slot.entry.sessionId);
      return;
    }
    // A turn shows the message already, so a copy here would show it twice.
    if (repeat) this.slots = this.slots.filter((candidate) => candidate !== slot);
    else if (error === null) this.delivered(slot);
    else if (!canTryAgain(error)) this.fail(slot, error instanceof Error ? error.message : null);
    else {
      const wait = retryWaitsMs[slot.tries - 1];
      if (wait === undefined) this.fail(slot, null);
      else this.wait(slot, wait);
    }
    this.pump(slot.entry.sessionId);
    this.changed();
  }

  private delivered(slot: Slot): void {
    this.stopTimer(slot);
    const now = this.turnCounts.get(slot.entry.sessionId) ?? slot.entry.turnCount;
    this.set(slot, { state: "sent", reason: null, turnCount: Math.max(slot.entry.turnCount, now) });
  }

  /** The message waits, and so do the later messages of its chat. */
  private wait(slot: Slot, ms: number): void {
    for (const later of this.laterOf(slot)) if (later.entry.state === "sending") this.set(later, { state: "waiting" });
    this.set(slot, { state: "waiting" });
    slot.timer = this.options.timers.set(() => {
      slot.timer = null;
      if (slot.entry.state !== "waiting") return;
      this.set(slot, { state: "sending" });
      for (const later of this.laterOf(slot))
        if (later.entry.state === "waiting") this.set(later, { state: "sending" });
      this.pump(slot.entry.sessionId);
      this.changed();
    }, ms);
  }

  private fail(slot: Slot, reason: string | null): void {
    this.set(slot, { state: "failed", reason });
    for (const later of this.laterOf(slot)) {
      if (later.entry.state === "sent") continue;
      this.stopTimer(later);
      this.set(later, { state: "failed", reason: followerReason(reason) });
    }
  }

  /** The first message of a chat that Eva does not have yet. */
  private headOf(sessionId: string): Slot | undefined {
    return this.slots.find((slot) => slot.entry.sessionId === sessionId && slot.entry.state !== "sent");
  }

  private laterOf(slot: Slot): Slot[] {
    const at = this.slots.indexOf(slot);
    return this.slots.slice(at + 1).filter((later) => later.entry.sessionId === slot.entry.sessionId);
  }

  private stopTimer(slot: Slot): void {
    if (slot.timer !== null) this.options.timers.clear(slot.timer);
    slot.timer = null;
  }

  /** Writes the entries to the tab at each change, so a reload at any moment keeps them. */
  private store(): void {
    const { storage } = this.options;
    if (storage === undefined) return;
    try {
      if (this.slots.length === 0) storage().removeItem(storageKey);
      else storage().setItem(storageKey, JSON.stringify(this.slots.map((slot) => slot.entry)));
    } catch {
      // The memory keeps the messages. An older list must not come back at a reload: it can hold a
      // message that the person took out for an edit, and Eva would run it as well as the edit.
      try {
        storage().removeItem(storageKey);
      } catch {
        // A blocked storage holds no list.
      }
    }
  }

  private set(slot: Slot, change: Partial<OutboxEntry>): void {
    const failed = change.state === "waiting" || change.state === "failed";
    slot.entry = { ...slot.entry, ...change, ...(failed ? { retried: true } : {}) };
  }

  private changed(): void {
    this.store();
    this.lists.clear();
    for (const listener of this.listeners) listener();
  }
}
