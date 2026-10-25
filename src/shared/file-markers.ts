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

/**
 * The text that a chat shows: no marker lines, and no marker that is still half written. A web
 * answer streams in pieces, and a folded step keeps only its first characters, so the last line
 * can hold the start of a marker. Telegram sends whole blocks and never needs this (lesson 124).
 */
export function shownAnswerText(answer: string): string {
  const text = extractFileMarkers(answer).text;
  const lastBreak = text.lastIndexOf("\n");
  return startsMarker(text.slice(lastBreak + 1)) ? text.slice(0, Math.max(lastBreak, 0)).trim() : text;
}

function startsMarker(line: string): boolean {
  const compact = line.replace(/\s+/g, "").toLowerCase();
  if (compact === "") return false;
  return ["[[attach:", "[[offer:"].some(
    (start) => start.startsWith(compact) || (compact.startsWith(start) && !compact.includes("]]")),
  );
}
