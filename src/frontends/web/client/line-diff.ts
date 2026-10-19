/**
 * A line diff for the two versions of a note conflict. Each side shows its own lines, and the
 * lines that the other side does not have stand out.
 */

export type DiffRow =
  | { readonly kind: "same" | "changed"; readonly text: string }
  /** Shared lines far from any change, hidden so a phone shows the change itself. */
  | { readonly kind: "gap"; readonly count: number };

export interface VersionComparison {
  readonly mine: readonly DiffRow[];
  readonly theirs: readonly DiffRow[];
}

/** The shared lines that stay visible around each change. */
const contextLines = 2;
/** Above this many cells, the comparison is too slow for a phone: every differing line counts as changed. */
const maxTableCells = 1_000_000;

/** Null stands for a side that deleted the note. */
export function compareVersions(mine: string | null, theirs: string | null): VersionComparison {
  const mineLines = linesOf(mine);
  const theirLines = linesOf(theirs);
  const [mineShared, theirShared] = sharedLines(mineLines, theirLines);
  return { mine: rowsOf(mineLines, mineShared), theirs: rowsOf(theirLines, theirShared) };
}

function linesOf(text: string | null): string[] {
  if (text === null || text === "") return [];
  const lines = text.split(/\r?\n/);
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
  if (rows === 0 || columns === 0 || rows * columns > maxTableCells) return [leftShared, rightShared];
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
  const changed = lines.map((_, index) => shared[index] !== true);
  if (!changed.includes(true)) return lines.map((text) => ({ kind: "same", text }));
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
  let hidden: string[] = [];
  const closeGap = (): void => {
    // A gap of one line takes as much room as the line itself.
    if (hidden.length === 1) rows.push({ kind: "same", text: hidden.join("") });
    else if (hidden.length > 1) rows.push({ kind: "gap", count: hidden.length });
    hidden = [];
  };
  lines.forEach((text, index) => {
    if ((distance[index] ?? 0) > contextLines) {
      hidden.push(text);
      return;
    }
    closeGap();
    rows.push({ kind: changed[index] === true ? "changed" : "same", text });
  });
  closeGap();
  return rows;
}
