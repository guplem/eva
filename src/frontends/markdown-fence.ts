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

/**
 * The opening line of a fenced code block: its indent, its fence and its language. As in
 * CommonMark, a backtick fence has no backtick after it, so "```npm i```" on one line is inline code.
 * The "(?!`)" takes the whole run first; without it, a long run backtracks in quadratic time.
 */
export const openingFencePattern = /^(\s*)(`{3,}(?!`)(?!.*`)|~{3,})\s*([\w+#.-]*)/;
