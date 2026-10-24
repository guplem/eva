/**
 * The unsent text of each chat in this browser tab. The page reloads itself after an update, so the
 * text lives in the tab's session storage. A private window or a blocked site can refuse the storage,
 * so each access has a fallback in memory.
 */

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

  /** The unsent text of a chat, or "". */
  get(draftKey: string): string {
    try {
      const stored = this.storage().getItem(keyPrefix + draftKey);
      if (stored !== null) return stored;
    } catch {
      // The memory keeps the text of this page.
    }
    return this.memory.get(draftKey) ?? "";
  }

  /** Keeps the text of a chat. An empty text removes it. */
  set(draftKey: string, text: string): void {
    if (text === "") this.memory.delete(draftKey);
    else this.memory.set(draftKey, text);
    try {
      if (text === "") this.storage().removeItem(keyPrefix + draftKey);
      else this.storage().setItem(keyPrefix + draftKey, text);
    } catch {
      // A full or blocked storage loses the text only at a reload.
    }
  }
}
