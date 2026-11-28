/**
 * Whether the person uses this page now (#1136). A page that stays in front on a computer says
 * nothing: the person may be away. Only a page with a reader holds back the notifications of the
 * other devices, and only such a page marks an answer as seen.
 */

/**
 * How long after the last input the person still counts as active. Someone who reads a long answer
 * moves nothing for a while. Someone who left the computer must get the answer on the phone.
 */
export const activeMs = 5 * 60_000;

export class PersonActivity {
  private readonly now: () => number;
  private lastInput: number;
  private readonly listeners: Set<() => void>;

  constructor(now: () => number) {
    this.now = now;
    // The person just opened the page.
    this.lastInput = now();
    this.listeners = new Set();
  }

  isActive(): boolean {
    return this.now() - this.lastInput < activeMs;
  }

  /** The person pressed a key, or moved or touched the page. */
  input(): void {
    const wasActive = this.isActive();
    this.lastInput = this.now();
    if (!wasActive) for (const listener of this.listeners) listener();
  }

  /** Calls the listener at the first input after a quiet time. Returns a function that stops it. */
  onBack(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** The activity on this page, which every part of the page shares. */
export const pageActivity = new PersonActivity(() => Date.now());
