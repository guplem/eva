/**
 * The block of the vault's `.gitattributes` that marks each encrypted file `-diff -merge -text` (#707):
 * git then never merges two encrypted versions line by line, and never changes their line ends on
 * Windows. Eva keeps the block between two marker lines, and the person's own lines outside it.
 */
import { join } from "node:path";
import { readTextTolerant, writeFileAtomic } from "../../shared/files.ts";

const startLine = "# Eva: encrypted files. Eva writes this block.";
const endLine = "# Eva: end of the encrypted files.";
const attributes = "-diff -merge -text";

/**
 * Writes each active pattern into the block. A line that Eva does not know stays: a newer Eva on
 * another machine wrote it. A pattern that a signed removal took out leaves the block.
 */
export function writeSecretAttributes(
  vaultPath: string,
  active: readonly string[],
  removed: ReadonlySet<string>,
): void {
  const path = join(vaultPath, ".gitattributes");
  const text = readTextTolerant(path) ?? "";
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  const start = lines.indexOf(startLine);
  const end = start === -1 ? -1 : lines.indexOf(endLine, start);
  // A start line with no end, such as after a hand edit, marks no block: only that line goes.
  const outside = start === -1 || end === -1 ? lines.filter((line) => line !== startLine) : null;
  const before = outside ?? lines.slice(0, start);
  const after = outside === null ? lines.slice(end + 1) : [];
  // Each pattern as the block writes it, so a kept line and a pattern of the list compare the same.
  const kept = outside === null ? lines.slice(start + 1, end).map(patternOf) : [];
  const gone = new Set([...removed].map(attributePath));
  const patterns = [...new Set([...kept, ...active.map(attributePath)])]
    .filter((pattern) => isAttributePattern(pattern) && !gone.has(pattern))
    .sort();
  const block = [startLine, ...patterns.map((pattern) => `${pattern} ${attributes}`), endLine];
  const next = [...before, ...block, ...after].join(newline) + newline;
  if (next !== text) writeFileAtomic(path, next);
}

/** The pattern of one line of the block: the text before its attributes. A comment line has none. */
function patternOf(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("#")) return "";
  return trimmed.split(/\s+/)[0] ?? "";
}

/** `.gitattributes` splits a line at each space and reads `#` as a comment, so such a pattern cannot go in. */
function isAttributePattern(pattern: string): boolean {
  return pattern !== "" && !/\s/.test(pattern) && !pattern.startsWith("#");
}

/** `.gitattributes` matches no folder, so a folder pattern marks the files inside it. */
function attributePath(pattern: string): string {
  return pattern.endsWith("/") ? `${pattern}**` : pattern;
}
