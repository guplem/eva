/** A toast stays a base time, plus a reading time for each word, so a long note is not lost. */
const baseMs = 4_000;
const perWordMs = 300;
/** A button needs time to reach: a finger moves, or the person thinks before a question. */
const actionMs = 3_000;
const longestMs = 15_000;

export function toastVisibleMs(text: string, hasAction: boolean): number {
  const words = text.split(/\s+/).filter((word) => word !== "").length;
  return Math.min(longestMs, baseMs + words * perWordMs + (hasAction ? actionMs : 0));
}
