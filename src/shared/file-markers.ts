/**
 * The marker lines that send a file with an answer (lessons 72 to 74, 124). A marker is plain
 * text, so every engine can write it, and every front end reads it with the same rules.
 */

export interface FileMarkers {
  /** The answer without the marker lines. */
  readonly text: string;
  readonly attach: readonly string[];
  readonly offer: readonly string[];
}

const markerPattern = /^\s*\[\[\s*(attach|offer)\s*:\s*(.+?)\s*\]\]\s*$/i;
const fencePattern = /^\s*(```|~~~)/;

/** Reads the marker lines of an answer block. A marker inside a code fence stays text. */
export function extractFileMarkers(answer: string): FileMarkers {
  const kept: string[] = [];
  const attach: string[] = [];
  const offer: string[] = [];
  let inFence = false;
  for (const line of answer.split("\n")) {
    if (fencePattern.test(line)) inFence = !inFence;
    const match = inFence ? null : markerPattern.exec(line);
    if (match === null) {
      kept.push(line);
      continue;
    }
    const path = match[2] ?? "";
    const list = match[1]?.toLowerCase() === "attach" ? attach : offer;
    if (!list.includes(path)) list.push(path);
  }
  // A file named twice goes once, and attach wins over offer.
  return { text: kept.join("\n").trim(), attach, offer: offer.filter((path) => !attach.includes(path)) };
}
