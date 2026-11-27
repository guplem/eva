/**
 * The text on one line, with no Markdown marks: they mean nothing in one short line. The chat
 * list preview and the push notifications both use it, so a reply reads the same in each (#1106).
 * It reads only the first `scanLength` characters: a cut keeps the regular expressions fast on a
 * long answer.
 */
export function plainLine(text: string, scanLength: number): string {
  const line = text
    .slice(0, scanLength)
    // A code block says little in one line, and its language name would look like a word.
    .replace(/```[^\n]*\n?[\s\S]*?(```|$)/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    // Emphasis touches its text. So "2 * 3 * 4" and "__init__.py" keep their marks.
    .replace(/(\*{1,3}|`+)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // A line of marks only says nothing.
  return /^[\s*_`#>~-]*$/.test(line) ? "" : line;
}
