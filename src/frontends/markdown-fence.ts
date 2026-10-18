/**
 * The CommonMark rule for the end of a fenced code block. Telegram and the web app both use
 * it, so a reply that shows a Markdown example keeps its inner fences on each front end.
 */

const bareFencePattern = /^\s*(`{3,}|~{3,})\s*$/;

/** Only a bare fence of the same character, at least as long, closes a block, so a block can show a shorter fence. */
export function closesFence(line: string, opening: string): boolean {
  const run = bareFencePattern.exec(line)?.[1] ?? "";
  return run.length >= opening.length && run.startsWith(opening.charAt(0));
}
