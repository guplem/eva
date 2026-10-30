/**
 * The unsent text of each chat. The page reloads itself after an update, so the text lives in the
 * tab's session storage. A private window or a blocked site can refuse the storage, so each access
 * has a fallback in memory.
 *
 * With a remote, Eva keeps each text too, so another device shows it (issue 652). A copy that Eva
 * does not have yet wins over a text from Eva: the newest change wins, and a reload loses nothing.
 */

import type { UnsentTextEvent, UnsentTexts as EvaTexts } from "../../../core/sessions/unsent-texts.ts";
import { restoredText } from "./conversation-parts.ts";

/** The part of the browser's `Storage` that the texts use. */
export type TextStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Eva's store of texts, through the local API. */
export interface TextRemote {
  list(): Promise<EvaTexts>;
  /** Gives the revision of the write. */
  save(key: string, text: string, keepEmpty: boolean): Promise<number>;
}

export interface SyncTimers {
  set(run: () => void, ms: number): unknown;
  clear(timer: unknown): void;
}

export interface TextSync {
  readonly remote: TextRemote;
  readonly timers: SyncTimers;
  /** The id of this page. Eva sends it back with each change, so the page skips its own changes. */
  readonly writer: string;
}

const keyPrefix = "eva-unsent:";
/** The revision of the copy that Eva has, or `dirty` for a change that Eva does not have yet. */
const revisionPrefix = "eva-unsent-revision:";
const dirty = "dirty";
/** A write per key stroke would flood Eva, and a long pause would lose the text at a page switch. */
const savePauseMs = 600;

export class UnsentTexts {
  private readonly storage: () => TextStorage;
  private readonly sync_: TextSync | null;
  /** The text of each chat on this page. Null is a text that Eva removed. */
  private readonly memory: Map<string, string | null>;
  private readonly revisions: Map<string, string>;
  private readonly listeners: Map<string, Set<() => void>>;
  private readonly timers: Map<string, unknown>;
  private readonly saving: Set<string>;
  /** The keys that asked for a write during their write, so they go to Eva again. */
  private readonly again: Set<string>;
  /** How many changes of each key this page made. A write that ends after a change leaves the key dirty. */
  private readonly changes: Map<string, number>;
  /** The newest read of Eva's texts. A key that this page reads later checks against it. */
  private lastRead: EvaTexts | null;

  /** `storage` is a function, because the browser can throw at the access itself. */
  constructor(storage: () => TextStorage, sync: TextSync | null = null) {
    this.storage = storage;
    this.sync_ = sync;
    this.memory = new Map();
    this.revisions = new Map();
    this.listeners = new Map();
    this.timers = new Map();
    this.saving = new Set();
    this.again = new Set();
    this.changes = new Map();
    this.lastRead = null;
  }

  /**
   * Calls `listener` at each change of a chat's text, and gives the function that stops it. A failed
   * send can restore the text from a message box that is gone, so the box on the page follows the store.
   */
  subscribe(draftKey: string, listener: () => void): () => void {
    const listeners = this.listeners.get(draftKey) ?? new Set();
    listeners.add(listener);
    this.listeners.set(draftKey, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(draftKey);
    };
  }

  /**
   * The unsent text of a chat, or "". The memory answers first: a write that the storage refused
   * would leave an older text there.
   */
  get(draftKey: string): string {
    return this.find(draftKey) ?? "";
  }

  /** The unsent text of a chat, or undefined when the chat has none, not even a cleared one. */
  find(draftKey: string): string | undefined {
    // A chat that this page did not show at the last read can have an older copy in the tab.
    if (this.lastRead !== null && !this.memory.has(draftKey)) this.takeRead(draftKey, this.lastRead, false);
    return this.local(draftKey);
  }

  /**
   * Puts the message of a failed send back, before the chat's newest draft, and gives the new text.
   * The message box that sent can be gone by then, so the kept draft is the newest one.
   */
  restore(draftKey: string, failed: string): string {
    const text = restoredText(failed, this.get(draftKey));
    this.set(draftKey, text);
    return text;
  }

  /**
   * Keeps the text of a chat. An empty text removes it, unless `keepEmpty` keeps the clear: a chat
   * that starts with a summary would show the summary again.
   */
  set(draftKey: string, text: string, keepEmpty = false): void {
    this.keep(draftKey, text, keepEmpty);
    this.changes.set(draftKey, (this.changes.get(draftKey) ?? 0) + 1);
    if (this.sync_ !== null) {
      this.setRevision(draftKey, dirty);
      this.schedule(draftKey);
    }
    this.tell(draftKey);
  }

  /** Takes a change that another page made. */
  receive(event: UnsentTextEvent): void {
    if (this.sync_ === null || event.writer === this.sync_.writer) return;
    this.take(event.key, event.text, event.revision, true);
  }

  /** Reads Eva's texts, at each connection: a device that slept missed the live changes. */
  async sync(): Promise<void> {
    if (this.sync_ === null) return;
    const read = await this.sync_.remote.list();
    this.lastRead = read;
    const keys = new Set([...this.memory.keys(), ...this.listeners.keys(), ...Object.keys(read.texts)]);
    for (const key of keys) this.takeRead(key, read, true);
  }

  /** Sends each change at once, because a hidden page can stop before the pause ends. */
  flushAll(): void {
    for (const key of [...this.timers.keys()]) this.save(key);
  }

  private local(draftKey: string): string | undefined {
    const kept = this.memory.get(draftKey);
    if (kept !== undefined) return kept ?? undefined;
    try {
      return this.storage().getItem(keyPrefix + draftKey) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private takeRead(key: string, read: EvaTexts, tell: boolean): void {
    const entry = read.texts[key];
    this.take(key, entry?.text ?? null, entry?.revision ?? read.revision, tell);
  }

  /** Takes Eva's text of a key, unless this page knows a newer one. */
  private take(key: string, text: string | null, revision: number, tell: boolean): void {
    const known = this.revision(key);
    if (known === dirty) {
      // Eva must get the change that this page has, also after a reload.
      if (!this.timers.has(key) && !this.saving.has(key)) this.schedule(key);
      return;
    }
    if (known !== undefined && Number(known) >= revision) return;
    this.keep(key, text, true);
    this.setRevision(key, String(revision));
    if (tell) this.tell(key);
  }

  /** Writes the text in memory and in the tab. Null and an empty text that is not kept remove it. */
  private keep(key: string, text: string | null, keepEmpty: boolean): void {
    const kept = text === "" && !keepEmpty ? null : text;
    // A removed text stays in memory too, so a clear that the storage refused still clears.
    this.memory.set(key, kept);
    try {
      if (kept === null) this.storage().removeItem(keyPrefix + key);
      else this.storage().setItem(keyPrefix + key, kept);
    } catch {
      // A full or blocked storage loses the text only at a reload.
    }
  }

  private revision(key: string): string | undefined {
    const kept = this.revisions.get(key);
    if (kept !== undefined) return kept;
    try {
      return this.storage().getItem(revisionPrefix + key) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private setRevision(key: string, revision: string): void {
    this.revisions.set(key, revision);
    try {
      this.storage().setItem(revisionPrefix + key, revision);
    } catch {
      // The memory keeps it for this page.
    }
  }

  private schedule(key: string): void {
    const sync = this.sync_;
    if (sync === null) return;
    sync.timers.clear(this.timers.get(key));
    this.timers.set(
      key,
      sync.timers.set(() => this.save(key), savePauseMs),
    );
  }

  private save(key: string): void {
    const sync = this.sync_;
    if (sync === null) return;
    sync.timers.clear(this.timers.get(key));
    this.timers.delete(key);
    if (this.saving.has(key)) {
      this.again.add(key);
      return;
    }
    const local = this.local(key);
    // Only a kept clear stays as an empty text.
    const keepEmpty = local === "";
    const change = this.changes.get(key);
    this.saving.add(key);
    sync.remote
      .save(key, local ?? "", keepEmpty)
      .then((revision) => {
        // A change during the write goes to Eva later, so it stays dirty.
        if (this.changes.get(key) === change) this.setRevision(key, String(revision));
      })
      .catch(() => {
        // The text stays dirty: the next connection or change sends it again.
      })
      .finally(() => {
        this.saving.delete(key);
        if (this.again.delete(key)) this.save(key);
      });
  }

  private tell(key: string): void {
    for (const listener of this.listeners.get(key) ?? []) listener();
  }
}
