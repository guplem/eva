import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addHistoryEntry,
  emptyHistory,
  historyKeepCount,
  markHistoryRead,
  openSince,
  readNotificationHistory,
  writeNotificationHistory,
  type HistoryEntry,
  type NotificationHistory,
} from "../../../../src/core/alerts/notification-history.ts";

let folder: string;
let path: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-history-"));
  path = join(folder, "state", "notification-history.json");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const day = 24 * 60 * 60_000;
const start = new Date("2026-10-17T10:00:00Z");

function add(
  history: NotificationHistory,
  key: string,
  level: "warn" | "error" | "resolved" | "news",
  at = start,
): NotificationHistory {
  return addHistoryEntry(history, { key, level, message: `${key} ${level}`, at: at.toISOString() }, at);
}

describe("notification history file", () => {
  test("keeps the entries and the next number across a write and a read", () => {
    const history = add(add(emptyHistory, "update", "warn"), "update", "resolved");
    writeNotificationHistory(path, history);
    expect(readNotificationHistory(path)).toEqual(history);
    expect(history.nextSeq).toBe(3);
    expect(history.entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(history.entries.every((entry) => !entry.read)).toBe(true);
  });

  test("a missing or broken file is an empty history", () => {
    expect(readNotificationHistory(path)).toEqual(emptyHistory);
    writeNotificationHistory(path, emptyHistory);
    writeFileSync(path, "{ not json");
    expect(readNotificationHistory(path)).toEqual(emptyHistory);
    writeFileSync(path, "null");
    expect(readNotificationHistory(path)).toEqual(emptyHistory);
  });

  test("a broken entry is skipped, and the others stay", () => {
    writeNotificationHistory(path, emptyHistory);
    const good: HistoryEntry = {
      seq: 4,
      key: "update",
      level: "news",
      message: "Eva updated.",
      at: start.toISOString(),
      read: true,
    };
    writeFileSync(path, JSON.stringify({ version: 1, nextSeq: 5, entries: [good, { seq: "x" }, 3] }));
    expect(readNotificationHistory(path)).toEqual({ nextSeq: 5, entries: [good] });
  });

  test("a next number below a stored entry moves past it, so no two entries share a number", () => {
    writeNotificationHistory(path, emptyHistory);
    const entry = { seq: 9, key: "update", level: "warn", message: "x", at: start.toISOString(), read: false };
    writeFileSync(path, JSON.stringify({ version: 1, nextSeq: 2, entries: [entry] }));
    expect(readNotificationHistory(path).nextSeq).toBe(10);
  });
});

describe("addHistoryEntry", () => {
  test("drops the entries older than 30 days", () => {
    const old = add(emptyHistory, "update", "warn", start);
    const later = add(old, "vault_sync", "error", new Date(start.getTime() + 31 * day));
    expect(later.entries.map((entry) => entry.key)).toEqual(["vault_sync"]);
  });

  test("keeps only the newest entries", () => {
    let history = emptyHistory;
    for (let index = 0; index < historyKeepCount + 3; index += 1) history = add(history, `k${String(index)}`, "news");
    expect(history.entries).toHaveLength(historyKeepCount);
    expect(history.entries[0]?.key).toBe("k3");
  });
});

describe("markHistoryRead", () => {
  test("marks the chosen entries only, and returns the same history when nothing changes", () => {
    const history = add(add(emptyHistory, "update", "warn"), "vault_sync", "error");
    const read = markHistoryRead(history, (entry) => entry.key === "update");
    expect(read.entries.map((entry) => entry.read)).toEqual([true, false]);
    expect(markHistoryRead(read, (entry) => entry.key === "update")).toBe(read);
  });
});

describe("openSince", () => {
  test("is the time of the start that no resolved entry followed", () => {
    const opened = add(emptyHistory, "update", "warn", start);
    const rose = add(opened, "update", "error", new Date(start.getTime() + day));
    expect(openSince(rose, "update")).toBe(start.toISOString());
    const resolved = add(rose, "update", "resolved", new Date(start.getTime() + 2 * day));
    expect(openSince(resolved, "update")).toBeNull();
    expect(openSince(emptyHistory, "update")).toBeNull();
  });
});
