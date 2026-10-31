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
  const before = start === -1 ? lines : lines.slice(0, start);
  const after = start === -1 || end === -1 ? [] : lines.slice(end + 1);
  const kept = start === -1 || end === -1 ? [] : lines.slice(start + 1, end).map(patternOf);
  const patterns = [...new Set([...kept, ...active])]
    .filter((pattern) => pattern !== "" && !removed.has(pattern))
    .sort();
  const block = [startLine, ...patterns.map((pattern) => `${pattern} ${attributes}`), endLine];
  const next = [...before, ...block, ...after].join(newline) + newline;
  if (next !== text) writeFileAtomic(path, next);
}

/** The pattern of one line of the block: the text before its attributes. */
function patternOf(line: string): string {
  return line.trim().split(/\s+/)[0] ?? "";
}
