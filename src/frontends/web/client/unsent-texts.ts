/**
 * The unsent text of each chat in this browser tab. The page reloads itself after an update, so the
 * text lives in the tab's session storage. A private window or a blocked site can refuse the storage,
 * so each access has a fallback in memory.
 */

import { restoredText } from "./conversation-parts.ts";

/** The part of the browser's `Storage` that the texts use. */
export type TextStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const keyPrefix = "eva-unsent:";

export class UnsentTexts {
  private readonly storage: () => TextStorage;
  private readonly memory: Map<string, string>;

  /** `storage` is a function, because the browser can throw at the access itself. */
  constructor(storage: () => TextStorage) {
    this.storage = storage;
    this.memory = new Map();
  }

  /**
   * The unsent text of a chat, or "". The memory answers first: a write that the storage refused
   * would leave an older text there.
   */
  get(draftKey: string): string {
    const kept = this.memory.get(draftKey);
    if (kept !== undefined) return kept;
    try {
      return this.storage().getItem(keyPrefix + draftKey) ?? "";
    } catch {
      return "";
    }
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

  /** Keeps the text of a chat. An empty text removes it. */
  set(draftKey: string, text: string): void {
    // An empty text stays in memory too, so a clear that the storage refused still clears.
    this.memory.set(draftKey, text);
    try {
      if (text === "") this.storage().removeItem(keyPrefix + draftKey);
      else this.storage().setItem(keyPrefix + draftKey, text);
    } catch {
      // A full or blocked storage loses the text only at a reload.
    }
  }
}
