/**
 * The marker lines that send a file with an answer (lessons 72 to 74, 124), show a page (#1129), or
 * suggest a reply (#1127).
 * A marker is plain text, so every engine can write it, and every front end reads it with the same rules.
 */

export interface FileMarkers {
  /** The answer without the marker lines. */
  readonly text: string;
  readonly attach: readonly string[];
  readonly offer: readonly string[];
  /** The pages that the web app shows inside the answer (#1129). */
  readonly show: readonly string[];
  /** A `[[quiet]]` line came: a scheduled run with nothing to say (#687). */
  readonly quiet: boolean;
  /** A `[[done]]` line came: a scheduled run that ends its schedule (#687). */
  readonly done: boolean;
  /** The replies that Eva suggests to the person (#1127), first the likeliest, within the limits below. */
  readonly replies: readonly string[];
}

/** A front end shows at most this many suggested replies. */
export const maxReplies = 4;
/** Telegram cuts a button label at 60 characters, so a longer reply would not fit a button (#1127). */
export const maxReplyLength = 60;

const markerPattern = /^\s*\[\[\s*(attach|offer|show)\s*:\s*(.+?)\s*\]\]\s*$/i;
const replyPattern = /^\s*\[\[\s*reply\s*:(.*?)\]\]\s*$/i;
/** Eva acts on these only in a scheduled run, but every front end hides them. */
const runMarkerPattern = /^\s*\[\[\s*(quiet|done)\s*\]\]\s*$/i;
const fencePattern = /^\s*(```|~~~)/;

/** Reads the marker lines of an answer block. A marker inside a code fence stays text. */
export function extractFileMarkers(answer: string): FileMarkers {
  const { kept, ...markers } = readMarkers(answer);
  return { text: kept.join("\n").trim(), ...markers };
}

function readMarkers(answer: string): Omit<FileMarkers, "text"> & { readonly kept: readonly string[] } {
  const kept: string[] = [];
  const attach: string[] = [];
  const offer: string[] = [];
  const show: string[] = [];
  let inFence = false;
  let quiet = false;
  let done = false;
  const replies: string[] = [];
  for (const line of answer.split("\n")) {
    if (fencePattern.test(line)) inFence = !inFence;
    const reply = inFence ? null : replyPattern.exec(line);
    if (reply !== null) {
      const text = (reply[1] ?? "").trim();
      if (fitsReply(text) && !replies.includes(text)) replies.push(text);
      continue;
    }
    const runMarker = inFence ? null : runMarkerPattern.exec(line);
    if (runMarker !== null) {
      if (runMarker[1]?.toLowerCase() === "quiet") quiet = true;
      else done = true;
      continue;
    }
    const match = inFence ? null : markerPattern.exec(line);
    if (match === null) {
      kept.push(line);
      continue;
    }
    const path = match[2] ?? "";
    const kind = match[1]?.toLowerCase();
    const list = kind === "attach" ? attach : kind === "show" ? show : offer;
    if (!list.includes(path)) list.push(path);
  }
  // A file named twice goes once, and attach wins over offer.
  return {
    kept,
    attach,
    offer: offer.filter((path) => !attach.includes(path)),
    show,
    quiet,
    done,
    replies: replies.slice(0, maxReplies),
  };
}

/** A reply that no front end can show leaves the text but is not offered. An emoji counts as one character. */
function fitsReply(text: string): boolean {
  const length = Array.from(text).length;
  return length > 0 && length <= maxReplyLength;
}

/**
 * The text that a chat shows, with no marker lines. An `open` text can end in the middle of a
 * line: a web answer streams in pieces, and a folded step keeps only its first characters. Its
 * last line can then hold the start of a marker, which goes too. Telegram sends whole blocks
 * and never needs this (lesson 124).
 */
export function shownAnswerText(answer: string, open = false): string {
  const text = extractFileMarkers(answer).text;
  const lastBreak = text.lastIndexOf("\n");
  if (!open || !startsMarker(text.slice(lastBreak + 1))) return text;
  return text.slice(0, Math.max(lastBreak, 0)).trim();
}

/**
 * The text of an answer with no marker lines, as a terminal writes it while the answer streams.
 * The terminal writes only what it did not write yet, so the spaces and line ends stay. An `open`
 * text holds back a last line that can start a marker, until that line is complete.
 */
export function untrimmedAnswerText(answer: string, open: boolean): string {
  const lines = [...readMarkers(answer).kept];
  const last = lines.at(-1) ?? "";
  // A line of spaces alone can still become a marker line with its next piece.
  if (!open || !(startsMarker(last) || last.trim() === "")) return lines.join("\n");
  lines.pop();
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function startsMarker(line: string): boolean {
  // A cut step ends with "…".
  const compact = line.replace(/\s+/g, "").replace(/…$/, "").toLowerCase();
  if (compact === "") return false;
  // A cut can also fall just after a whole marker, so its line then ends with "]]…".
  return ["[[attach:", "[[offer:", "[[show:", "[[reply:", "[[quiet]]", "[[done]]"].some(
    (start) => start.startsWith(compact) || compact.startsWith(start),
  );
}
