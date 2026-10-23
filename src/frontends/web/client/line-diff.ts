/**
 * Line diffs of two texts. `compareVersions` shows each side of a note conflict on its own, and the
 * lines that the other side does not have stand out. `diffLines` shows one list, as git does: the
 * removed lines, then the added lines. Line endings do not count: CRLF and LF read the same.
 */

export type DiffRow =
  | { readonly kind: "same" | "changed" | "added" | "removed"; readonly text: string }
  /** Shared lines far from any change, hidden so a phone shows the change itself. */
  | { readonly kind: "gap"; readonly count: number };

type LineRow = Exclude<DiffRow, { readonly kind: "gap" }>;

export interface VersionComparison {
  readonly mine: readonly DiffRow[];
  readonly theirs: readonly DiffRow[];
}

/** The shared lines that stay visible around each change. */
const contextLines = 2;
/** Above this many cells, the exact comparison is too slow for a phone, and a quicker one runs instead. */
const maxTableCells = 1_000_000;

/** Null stands for a side that deleted the note. */
export function compareVersions(mine: string | null, theirs: string | null): VersionComparison {
  const mineLines = linesOf(mine);
  const theirLines = linesOf(theirs);
  const [mineShared, theirShared] = sharedLines(mineLines, theirLines);
  return { mine: rowsOf(mineLines, mineShared), theirs: rowsOf(theirLines, theirShared) };
}

/** The changes from `before` to `after`, in one list. */
export function diffLines(before: string, after: string): DiffRow[] {
  const beforeLines = linesOf(before);
  const afterLines = linesOf(after);
  const [beforeShared, afterShared] = sharedLines(beforeLines, afterLines);
  const rows: LineRow[] = [];
  let i = 0;
  let j = 0;
  while (i < beforeLines.length || j < afterLines.length) {
    const removed = beforeLines[i];
    const added = afterLines[j];
    if (removed !== undefined && removed === added && beforeShared[i] === true && afterShared[j] === true) {
      rows.push({ kind: "same", text: removed });
      i += 1;
      j += 1;
    } else if (removed !== undefined && (beforeShared[i] !== true || added === undefined)) {
      rows.push({ kind: "removed", text: removed });
      i += 1;
    } else if (added !== undefined && afterShared[j] !== true) {
      rows.push({ kind: "added", text: added });
      j += 1;
    } else if (removed !== undefined) {
      // The quick comparison of long texts marks shared lines out of order, so the two do not pair up.
      rows.push({ kind: "removed", text: removed });
      i += 1;
    } else if (added !== undefined) {
      rows.push({ kind: "added", text: added });
      j += 1;
    }
  }
  return folded(rows);
}

function linesOf(text: string | null): string[] {
  if (text === null || text === "") return [];
  // A byte order mark is invisible: without this, a file that starts with one differs on its first line.
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Which lines of each side belong to their longest common subsequence. */
function sharedLines(left: readonly string[], right: readonly string[]): [boolean[], boolean[]] {
  const leftShared: boolean[] = left.map(() => false);
  const rightShared: boolean[] = right.map(() => false);
  // The same start and end cost nothing, and keep the table small.
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) {
    leftShared[start] = true;
    rightShared[start] = true;
    start += 1;
  }
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd -= 1;
    rightEnd -= 1;
    leftShared[leftEnd] = true;
    rightShared[rightEnd] = true;
  }
  const rows = leftEnd - start;
  const columns = rightEnd - start;
  if (rows === 0 || columns === 0) return [leftShared, rightShared];
  if (rows * columns > maxTableCells) {
    // A line that the other side also has counts as shared, wherever it is.
    const leftLines = new Set(left.slice(start, leftEnd));
    const rightLines = new Set(right.slice(start, rightEnd));
    for (let i = start; i < leftEnd; i += 1) leftShared[i] = rightLines.has(left[i] ?? "");
    for (let j = start; j < rightEnd; j += 1) rightShared[j] = leftLines.has(right[j] ?? "");
    return [leftShared, rightShared];
  }
  // lengths[i][j]: the common subsequence of the middle lines from i and from j on.
  const lengths = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    const row = lengths[i] as Uint32Array;
    const below = lengths[i + 1] as Uint32Array;
    for (let j = columns - 1; j >= 0; j -= 1) {
      row[j] =
        left[start + i] === right[start + j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (left[start + i] === right[start + j]) {
      leftShared[start + i] = true;
      rightShared[start + j] = true;
      i += 1;
      j += 1;
    } else if ((lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return [leftShared, rightShared];
}

function rowsOf(lines: readonly string[], shared: readonly boolean[]): DiffRow[] {
  return folded(lines.map((text, index) => ({ kind: shared[index] === true ? "same" : "changed", text })));
}

/** Hides the shared lines far from any change. */
function folded(lines: readonly LineRow[]): DiffRow[] {
  const changed = lines.map((row) => row.kind !== "same");
  if (!changed.includes(true)) return [...lines];
  // The distance from each line to the nearest change, in two passes.
  const distance: number[] = [];
  let sinceChange = Infinity;
  changed.forEach((isChanged, index) => {
    sinceChange = isChanged ? 0 : sinceChange + 1;
    distance[index] = sinceChange;
  });
  let untilChange = Infinity;
  for (let index = changed.length - 1; index >= 0; index -= 1) {
    untilChange = changed[index] === true ? 0 : untilChange + 1;
    distance[index] = Math.min(distance[index] ?? Infinity, untilChange);
  }
  const rows: DiffRow[] = [];
  let hidden: LineRow[] = [];
  const closeGap = (): void => {
    // A gap of one line takes as much room as the line itself.
    if (hidden.length === 1) rows.push(...hidden);
    else if (hidden.length > 1) rows.push({ kind: "gap", count: hidden.length });
    hidden = [];
  };
  lines.forEach((row, index) => {
    if ((distance[index] ?? 0) > contextLines) {
      hidden.push(row);
      return;
    }
    closeGap();
    rows.push(row);
  });
  closeGap();
  return rows;
}
