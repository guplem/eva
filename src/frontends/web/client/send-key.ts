/**
 * The key that sends a message in the web chat. The other Enter keys add a new line. Each browser keeps its own
 * choice in `localStorage`, as with the look: a phone keyboard and a computer keyboard need different keys.
 */

/** "ctrl-enter" also means Cmd+Enter on a Mac. */
export type SendKey = "ctrl-enter" | "enter" | "shift-enter";

/** A stray Enter never sends half a message (#1040), so Ctrl+Enter is the default. */
export const defaultSendKey: SendKey = "ctrl-enter";

const storageKey = "eva.send-key";

function isSendKey(value: unknown): value is SendKey {
  return value === "ctrl-enter" || value === "enter" || value === "shift-enter";
}

/** A private window, blocked storage or a broken value gives the default. */
export function readSendKey(): SendKey {
  try {
    const stored = localStorage.getItem(storageKey);
    return isSendKey(stored) ? stored : defaultSendKey;
  } catch {
    return defaultSendKey;
  }
}

export function saveSendKey(sendKey: SendKey): void {
  try {
    localStorage.setItem(storageKey, sendKey);
  } catch {
    // With blocked storage, the message box keeps the default key.
  }
}
