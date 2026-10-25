/** The parts of the chat list that need no page: groups, times, previews, states and the search. */
import type { SessionRecord } from "./api.ts";
import { branchNames, type BranchSession } from "./branch-path.ts";
import { turnLine } from "../../../shared/project-report.ts";

export type ChatGroup = "Today" | "This week" | "Older";

/**
 * "Needs you" wins over "Working": the turn waits for the approval. "Working" wins over "Unread":
 * the answer that the person did not see is not the last one.
 */
export type ChatState = "needs-you" | "working" | "unread" | null;

const dayMs = 24 * 60 * 60 * 1000;
// Fixed English names: the rest of the page is in English, whatever the browser's language.
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const previewLength = 140;

/** Whole local days from `at` to `now`. A clock change makes one day 23 or 25 hours, so the count rounds. */
export function daysBefore(at: Date, now: Date): number {
  const start = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((start(now) - start(at)) / dayMs);
}

/** A time a little in the future, from another machine's clock, counts as today. */
export function chatGroup(at: Date, now: Date): ChatGroup {
  const days = daysBefore(at, now);
  // A bad stored time gives NaN, and NaN fails every comparison.
  if (Number.isNaN(days)) return "Older";
  if (days <= 0) return "Today";
  return days < 7 ? "This week" : "Older";
}

/** "09:14" today, "Mon" this week, "12 Oct" before, and "12 Oct 2025" in another year. */
export function chatTime(at: Date, now: Date): string {
  if (Number.isNaN(at.getTime())) return "";
  const group = chatGroup(at, now);
  if (group === "Today") {
    return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  }
  if (group === "This week") return weekdays[at.getDay()] ?? "";
  const day = `${String(at.getDate())} ${months[at.getMonth()] ?? ""}`;
  return at.getFullYear() === now.getFullYear() ? day : `${day} ${String(at.getFullYear())}`;
}

/**
 * One line of the last message: the answer, why the turn failed, or the person's message.
 * A waiting approval or question comes first: the last answer no longer tells the current state.
 */
export function chatPreview(chat: Pick<SessionRecord, "turns">, state: ChatState = null): string {
  if (state === "needs-you") return "Eva waits for your answer";
  const last = chat.turns.at(-1);
  if (last === undefined) return state === "working" ? "Eva is working on it" : "No messages yet";
  const line = oneLine(last.failure ?? "") || oneLine(last.answerText) || oneLine(turnLine(last));
  if (line === "") return "No messages yet";
  // By code point, so the cut never splits an emoji.
  const characters = Array.from(line);
  return characters.length > previewLength ? `${characters.slice(0, previewLength).join("").trimEnd()}…` : line;
}

/** The text on one line, with no Markdown marks: they mean nothing in one short line. */
function oneLine(text: string): string {
  const line = text
    // The preview shows 140 characters. A cut keeps the regular expressions fast on a long answer.
    .slice(0, previewLength * 4)
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

/** The state of a chat and its forks. Any session of the tree counts. */
export function chatState(
  tree: readonly Pick<SessionRecord, "id" | "turns" | "seenTurns">[],
  isRunning: (sessionId: string) => boolean,
  approvalSessionIds: readonly string[],
): ChatState {
  if (tree.some((session) => approvalSessionIds.includes(session.id))) return "needs-you";
  if (tree.some((session) => isRunning(session.id))) return "working";
  return tree.some(hasUnseenTurns) ? "unread" : null;
}

/** The core stores a turn only when it ends, so a running turn never counts as unseen. */
export function hasUnseenTurns(session: Pick<SessionRecord, "turns" | "seenTurns">): boolean {
  return session.turns.length > session.seenTurns;
}

/** Case and the spaces around the query do not count. An empty query keeps every chat. */
export function matchesSearch(title: string, query: string): boolean {
  return title.toLowerCase().includes(query.trim().toLowerCase());
}

/** The chats in their day groups, in list order. A group with no chat is left out. */
export function groupChats<Chat>(
  chats: readonly Chat[],
  timeOf: (chat: Chat) => Date,
  now: Date,
): { readonly group: ChatGroup; readonly chats: Chat[] }[] {
  const groups: { group: ChatGroup; chats: Chat[] }[] = [];
  for (const chat of chats) {
    const group = chatGroup(timeOf(chat), now);
    const last = groups.at(-1);
    if (last?.group === group) last.chats.push(chat);
    else groups.push({ group, chats: [chat] });
  }
  return groups;
}

/** The words of each state's pill: a state shows with a word, never with colour alone. */
export const chatStateLabels: Record<NonNullable<ChatState>, string> = {
  "needs-you": "Needs you",
  working: "Working",
  unread: "Unread",
};

/** The branches that a chat lists under its row, by name. A chat with no fork lists none. */
export function chatForks<S extends BranchSession>(
  tree: readonly S[],
): { readonly session: S; readonly name: string }[] {
  if (tree.length < 2) return [];
  const names = branchNames(tree);
  return tree.map((session) => ({ session, name: names.get(session.id) ?? "" }));
}
