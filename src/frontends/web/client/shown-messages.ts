/**
 * The messages that the page shows before Eva stores them (#1053): a sent message, and the answer of a running turn.
 * The stored turn draws a new element in their place. Without this list, the new element plays its fade in again,
 * and the message blinks.
 */

/** The keys of the newest messages that wait for their stored copy, oldest first. */
const waiting: string[] = [];
const kept = 20;

/** The key of the person's message with these words. */
export function sentKey(text: string): string {
  return `sent:${text}`;
}

/** The key of the answer of the running turn of this session. */
export function answerKey(sessionId: string): string {
  return `answer:${sessionId}`;
}

/** Notes that the page shows the message `key`, and that a new element will take its place. */
export function noteShown(key: string): void {
  if (waiting.includes(key)) return;
  waiting.push(key);
  if (waiting.length > kept) waiting.shift();
}

/** True when the page showed the message `key` already, so its new element shows with no fade. Each note answers once. */
export function takeShown(key: string): boolean {
  const index = waiting.indexOf(key);
  if (index === -1) return false;
  waiting.splice(index, 1);
  return true;
}

/** Empties the list. */
export function forgetShown(): void {
  waiting.length = 0;
}
