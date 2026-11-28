/**
 * The suggested replies of the message box (#1127). Eva ends an answer with `[[reply: <text>]]` lines,
 * and the empty box offers the first one in grey. Tab or a tap sends it at once.
 */
import type { ChatKind } from "../../../shared/chat-kind.ts";
import { extractFileMarkers } from "../../../shared/file-markers.ts";

/**
 * The replies that the newest answer of a chat offers, or none. A Project chat stays a plain harness
 * (AGENTS.md), so only a chat with Eva offers them. A failed or stopped answer offers none: the core
 * stores a stop as a failure.
 */
export function chatReplies(chat: {
  readonly kind: ChatKind;
  readonly closed: boolean;
  /** A turn runs, a sent message waits, or an approval or a question waits. */
  readonly busy: boolean;
  readonly newest: { readonly answerText: string; readonly failure: string | null } | undefined;
}): readonly string[] {
  const { kind, closed, busy, newest } = chat;
  if (kind !== "assistant" || closed || busy || newest?.failure !== null) return [];
  return extractFileMarkers(newest.answerText).replies;
}

/**
 * The replies that the box shows now. Any typed character hides them, also a space: Tab would otherwise send the reply
 * and drop it. A file hides them too, and a cleared box brings them back.
 */
export function shownReplies(
  replies: readonly string[],
  box: {
    readonly text: string;
    /** The count of attached files. */
    readonly files: number;
    readonly locked: boolean;
    /** The box sends, uploads a file or runs a text action. */
    readonly busy: boolean;
  },
): readonly string[] {
  return box.text === "" && box.files === 0 && !box.locked && !box.busy ? replies : [];
}

/** The parts of a key press in the message box that decide whether Tab sends the suggestion. */
export interface SuggestionKey {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;
}

/** The code that a browser gives a key press that an input method handles. */
const inputMethodKeyCode = 229;

/**
 * True when the key sends the suggestion: a plain Tab while the box shows one and the mention list
 * is closed. Every other Tab moves the focus as before, so a keyboard user leaves the box with
 * Shift+Tab, or with Tab after one typed character.
 */
export function sendsSuggestion(
  press: SuggestionKey,
  state: { readonly shown: boolean; readonly mentionOpen: boolean },
): boolean {
  if (press.key !== "Tab" || press.isComposing || press.keyCode === inputMethodKeyCode) return false;
  if (press.shiftKey || press.ctrlKey || press.metaKey || press.altKey) return false;
  return state.shown && !state.mentionOpen;
}

/** The box shows the reply as a picture of text, so a screen reader gets it from this line. */
export function suggestionHint(reply: string): string {
  return `Suggested reply: ${reply}. Press Tab to send it.`;
}

export function moreRepliesLabel(count: number): string {
  return `${String(count)} more suggested ${count === 1 ? "reply" : "replies"}`;
}
