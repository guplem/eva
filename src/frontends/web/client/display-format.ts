/**
 * The person's clock and first day of the week, as the last status said (#770). The app sets it
 * and renders again, so each time and each week on the page follows the settings. Until the status
 * comes, and with an older Eva, the page keeps the old forms: 24-hour, from Monday.
 */
import { defaultDisplayFormat, isClock, isWeekStart, type DisplayFormat } from "../../../shared/time-format.ts";

let current: DisplayFormat = defaultDisplayFormat;
const listeners = new Set<() => void>();

/** Calls the listener after each change, so the app renders again. Returns the unsubscribe. */
export function onDisplayFormatChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function displayFormat(): DisplayFormat {
  return current;
}

/** Keeps a format from the status. A value that this page does not know reads as not set. True when it changed. */
export function setDisplayFormat(next: Partial<DisplayFormat> | undefined): boolean {
  const clock = isClock(next?.clock) ? next.clock : null;
  const weekStart = isWeekStart(next?.weekStart) ? next.weekStart : null;
  if (clock === current.clock && weekStart === current.weekStart) return false;
  current = { clock, weekStart };
  for (const listener of listeners) listener();
  return true;
}
