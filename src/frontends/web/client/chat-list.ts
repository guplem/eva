/** The parts of the chat list that need no page: groups, times, previews, states and the search. */
import type { SessionRecord } from "./api.ts";

export type ChatGroup = "Today" | "This week" | "Older";

/** "Needs you" wins over "Working": an approval holds a running turn. */
export type ChatState = "needs-you" | "working" | null;

const dayMs = 24 * 60 * 60 * 1000;
// Fixed English names: the rest of the page is in English, whatever the browser's language.
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const previewLength = 140;

/** Whole local days from `at` to `now`. A clock change makes one day 23 or 25 hours, so the count rounds. */
function daysBefore(at: Date, now: Date): number {
  const start = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((start(now) - start(at)) / dayMs);
}

/** A time a little in the future, from another machine's clock, counts as today. */
export function chatGroup(at: Date, now: Date): ChatGroup {
  const days = daysBefore(at, now);
  if (days <= 0) return "Today";
  return days < 7 ? "This week" : "Older";
}

/** "09:14" today, "Mon" this week, "12 Oct" before, and "12 Oct 2025" in another year. */
export function chatTime(at: Date, now: Date): string {
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
 * A waiting approval comes first, because the last answer is old news then.
 */
export function chatPreview(chat: Pick<SessionRecord, "turns">, state: ChatState = null): string {
  if (state === "needs-you") return "Eva needs your permission";
  const last = chat.turns.at(-1);
  if (last === undefined) return state === "working" ? "Eva is working on it" : "No messages yet";
  const text = last.failure ?? (last.answerText.trim() === "" ? last.userText : last.answerText);
  // The Markdown marks mean nothing in one short line.
  const line = text
    .replace(/[*`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > previewLength ? `${line.slice(0, previewLength)}…` : line;
}

/** The state of a chat and its forks. Any session of the tree counts. */
export function chatState(
  treeIds: readonly string[],
  isRunning: (sessionId: string) => boolean,
  approvalSessionIds: readonly string[],
): ChatState {
  if (approvalSessionIds.some((id) => treeIds.includes(id))) return "needs-you";
  return treeIds.some(isRunning) ? "working" : null;
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
