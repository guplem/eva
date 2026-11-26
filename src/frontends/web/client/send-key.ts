/**
 * The keys that send a message in the web chat. The other Enter keys add a new line. Each browser keeps its own
 * choice in `localStorage`, as with the look: a phone keyboard and a computer keyboard need different keys.
 * A person can choose several keys, or none: then only the send button sends (#1097).
 */

/** "ctrl-enter" also means Cmd+Enter on a Mac. */
export type SendKey = "ctrl-enter" | "enter" | "shift-enter";

/** The order of the chips and of the stored list. */
export const sendKeyOrder: readonly SendKey[] = ["ctrl-enter", "enter", "shift-enter"];

/** A stray Enter never sends half a message (#1040), so Ctrl+Enter is the default. */
export const defaultSendKeys: readonly SendKey[] = ["ctrl-enter"];

const storageKey = "eva.send-keys";

/**
 * The single key of the time before #1097. A browser that chose a key then keeps the keys that sent then:
 * the old Enter choice also sent on Ctrl+Enter.
 */
const oldStorageKey = "eva.send-key";
// A Map, not an object: an old value such as "toString" must not find a built-in function.
const oldChoices = new Map<string, readonly SendKey[]>([
  ["ctrl-enter", ["ctrl-enter"]],
  ["enter", ["ctrl-enter", "enter"]],
  ["shift-enter", ["shift-enter"]],
]);

function isSendKey(value: unknown): value is SendKey {
  return sendKeyOrder.includes(value as SendKey);
}

function inOrder(keys: readonly SendKey[]): SendKey[] {
  return sendKeyOrder.filter((key) => keys.includes(key));
}

function parsed(stored: string): readonly SendKey[] {
  try {
    const value: unknown = JSON.parse(stored);
    return Array.isArray(value) && value.every(isSendKey) ? inOrder(value) : defaultSendKeys;
  } catch {
    return defaultSendKeys;
  }
}

/** A private window, blocked storage or a broken value gives the default. */
export function readSendKeys(): readonly SendKey[] {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored !== null) return parsed(stored);
    const old = localStorage.getItem(oldStorageKey);
    return (old !== null ? oldChoices.get(old) : undefined) ?? defaultSendKeys;
  } catch {
    return defaultSendKeys;
  }
}

export function saveSendKeys(keys: readonly SendKey[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(inOrder(keys)));
  } catch {
    // With blocked storage, the message box keeps the default key.
  }
}

export const sendKeyLabels: Record<SendKey, string> = {
  "ctrl-enter": "Ctrl+Enter",
  enter: "Enter",
  "shift-enter": "Shift+Enter",
};

function listed(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1) ?? ""}`;
}

/** The hint under the chips: which keys send, and which Enter keys add a new line. */
export function sendKeyHint(keys: readonly SendKey[]): string {
  const chosen = inOrder(keys);
  const newLine = (["enter", "shift-enter"] as const)
    .filter((key) => !chosen.includes(key))
    .map((key) => sendKeyLabels[key]);
  const parts = [
    chosen.length === 0
      ? "Only the send button sends."
      : `${listed(chosen.map((key) => sendKeyLabels[key]))} ${chosen.length === 1 ? "sends" : "send"}.`,
  ];
  if (chosen.includes("ctrl-enter")) parts.push("On a Mac, Cmd+Enter sends too.");
  // Ctrl+Enter adds no line in a text box, so with both Enter keys on, no key adds one.
  if (newLine.length === 0) parts.push("No key then adds a new line.");
  else parts.push(`${listed(newLine)} ${newLine.length === 1 ? "adds" : "add"} a new line.`);
  // A phone keyboard has no Shift or Ctrl key, so its Enter is the only key for a new line.
  if (newLine.length === 1 && chosen.includes("enter")) parts.push("A phone keyboard then has no key for a new line.");
  return parts.join(" ");
}
