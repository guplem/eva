/**
 * What Eva told the person, in the machine's state folder: each problem start, each resolved
 * problem and each piece of news. The notification center lists it. Each machine keeps its own.
 */
import { z } from "zod";
import { readJsonTolerant, writeFileAtomic } from "../../shared/files.ts";

export type HistoryLevel = "warn" | "error" | "resolved" | "news";

export interface HistoryEntry {
  /** Grows across restarts, so it orders the entries and names one of them (lesson 83). */
  readonly seq: number;
  readonly key: string;
  readonly level: HistoryLevel;
  /** Redacted, as each alert is. */
  readonly message: string;
  readonly at: string;
  readonly read: boolean;
}

export interface NotificationHistory {
  readonly nextSeq: number;
  readonly entries: readonly HistoryEntry[];
}

export const emptyHistory: NotificationHistory = { nextSeq: 1, entries: [] };

/** The person asked for about a month of history. */
const keepMs = 30 * 24 * 60 * 60_000;
/** A loop that fails every minute must not grow the file without end. */
export const historyKeepCount = 500;

const entrySchema = z.object({
  seq: z.number().int().positive(),
  key: z.string(),
  level: z.enum(["warn", "error", "resolved", "news"]),
  message: z.string(),
  at: z.string(),
  read: z.boolean(),
});

/** A missing or broken file is an empty history. A broken entry costs only itself. */
export function readNotificationHistory(path: string): NotificationHistory {
  const read = readJsonTolerant(path);
  if (!read.ok || read.value === null || typeof read.value !== "object") return emptyHistory;
  const { nextSeq, entries } = read.value as { nextSeq?: unknown; entries?: unknown };
  const kept = (Array.isArray(entries) ? entries : []).flatMap((entry: unknown) => {
    const parsed = entrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  const highest = kept.reduce((max, entry) => Math.max(max, entry.seq), 0);
  const stored = typeof nextSeq === "number" && Number.isInteger(nextSeq) ? nextSeq : 1;
  return { nextSeq: Math.max(stored, highest + 1), entries: kept };
}

export function writeNotificationHistory(path: string, history: NotificationHistory): void {
  writeFileAtomic(path, `${JSON.stringify({ version: 1, ...history }, null, 2)}\n`);
}

/** Adds one unread entry, and drops the entries that are too old or too many. */
export function addHistoryEntry(
  history: NotificationHistory,
  entry: Omit<HistoryEntry, "seq" | "read">,
  now: Date,
): NotificationHistory {
  const oldest = now.getTime() - keepMs;
  const entries = [...history.entries, { ...entry, seq: history.nextSeq, read: false }]
    .filter((kept) => Date.parse(kept.at) >= oldest)
    .slice(-historyKeepCount);
  return { nextSeq: history.nextSeq + 1, entries };
}

/** The same history when no chosen entry was unread, so a caller can skip the write. */
export function markHistoryRead(
  history: NotificationHistory,
  chosen: (entry: HistoryEntry) => boolean,
): NotificationHistory {
  if (!history.entries.some((entry) => !entry.read && chosen(entry))) return history;
  return { ...history, entries: history.entries.map((entry) => (chosen(entry) ? { ...entry, read: true } : entry)) };
}

/** When the open problem of a key started, from before a restart. Null when no open start is kept. */
export function openSince(history: NotificationHistory, key: string): string | null {
  let since: string | null = null;
  for (const entry of history.entries) {
    if (entry.key !== key) continue;
    if (entry.level === "resolved") since = null;
    else if (since === null && (entry.level === "warn" || entry.level === "error")) since = entry.at;
  }
  return since;
}
