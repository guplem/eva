/** The words and the order of the notification center (#566). The page itself is NotificationCenter.tsx. */
import type { HistoryEntry } from "../../../core/alerts/notification-history.ts";

export type CenterFilter = "all" | "unread" | "problems";

export const centerFilters: readonly { readonly id: CenterFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "problems", label: "Problems" },
];

// The page is English, so the dates are too, whatever the browser's language.
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today", "Yesterday", or a short date, in the browser's time zone. */
export function dayLabel(at: string, now: Date): string {
  const date = new Date(at);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${weekdays[date.getDay()] ?? ""} ${String(date.getDate())} ${months[date.getMonth()] ?? ""}`;
}

/** The hour and minute, after the day when the day is not today. */
export function timeLabel(at: string, now: Date): string {
  const date = new Date(at);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const day = dayLabel(at, now);
  return day === "Today" ? time : `${day}, ${time}`;
}

export interface HistoryGroup {
  readonly day: string;
  readonly entries: readonly HistoryEntry[];
}

/** The newest entry first, by `seq` (lesson 83), grouped by day. */
export function historyGroups(entries: readonly HistoryEntry[], filter: CenterFilter, now: Date): HistoryGroup[] {
  const kept = [...entries]
    .filter((entry) => {
      if (filter === "unread") return !entry.read;
      if (filter === "problems") return entry.level === "warn" || entry.level === "error";
      return true;
    })
    .sort((first, second) => second.seq - first.seq);
  const groups: { day: string; entries: HistoryEntry[] }[] = [];
  for (const entry of kept) {
    const day = dayLabel(entry.at, now);
    const last = groups.at(-1);
    if (last?.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }
  return groups;
}

/** The open problems that the filter shows. A read problem is a hidden one. */
export function shownNeeds<Problem extends { readonly hidden?: boolean }>(
  problems: readonly Problem[],
  filter: CenterFilter,
): Problem[] {
  return filter === "unread" ? problems.filter((problem) => problem.hidden !== true) : [...problems];
}
