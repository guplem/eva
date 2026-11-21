/**
 * Who wrote the text that Eva put in a message box, such as a widget (#696), and a request to focus
 * the box after such a fill. The box shows the source until the person sends or clears the text.
 * Each value lives in this tab only, by the draft key of the box.
 */

const sources = new Map<string, string>();
const focusAsks = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

function tell(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

/**
 * Eva filled the box. `source` names who wrote the text, such as a widget, and the box then takes the
 * focus. With no source, Eva wrote it herself, as a mention of a project, and the focus stays.
 */
export function noteFill(key: string, source: string | undefined): void {
  if (source === undefined) sources.delete(key);
  else {
    sources.set(key, source);
    focusAsks.add(key);
  }
  tell(key);
}

/** Who wrote the text of the box with this draft key, such as "Cases", or null. */
export function textSourceOf(key: string): string | null {
  return sources.get(key) ?? null;
}

/** The person sent or cleared the text: the box no longer names who wrote it. */
export function clearTextSource(key: string): void {
  if (sources.delete(key)) tell(key);
}

/** True once after a fill: the box then takes the focus. */
export function takeFocusAsk(key: string): boolean {
  return focusAsks.delete(key);
}

/** Calls `listener` after each fill of the box with this draft key, and each clear of its source. */
export function onTextSource(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set();
  set.add(listener);
  listeners.set(key, set);
  return () => {
    set.delete(listener);
  };
}
