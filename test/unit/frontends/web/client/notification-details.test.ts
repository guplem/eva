import { describe, expect, test } from "bun:test";
import type { HistoryEntry } from "../../../../../src/core/alerts/notification-history.ts";
import {
  entryState,
  notificationTopic,
  sameProblemEntries,
} from "../../../../../src/frontends/web/client/notification-details.ts";

function entry(seq: number, key: string, level: HistoryEntry["level"]): HistoryEntry {
  return { seq, key, level, message: `m${String(seq)}`, at: new Date(2026, 9, 25, 9, seq).toISOString(), read: false };
}

describe("notificationTopic", () => {
  test("explains a schedule that waits for its setup card, and why Eva waits", () => {
    const topic = notificationTopic("schedule_card:morning");
    expect(topic.title).toBe("Schedule check");
    expect(topic.meaning).toContain("you confirm the card");
    expect(topic.meaning).toContain("does not run");
  });

  test("picks the topic by the key's kind, never by the id after it", () => {
    expect(notificationTopic("engine_login:pi").title).toBe(notificationTopic("engine_login:claude-code").title);
    expect(notificationTopic("schedule:a").title).toBe("Schedule run");
    expect(notificationTopic("migration_failed:vault").title).toBe("File upgrade failed");
  });

  test("names the other computer of a relayed problem, with the topic of its own key", () => {
    const topic = notificationTopic("machine:laptop:vault_sync");
    expect(topic.title).toBe("On laptop: Vault sync");
    expect(topic.meaning).toStartWith("Another computer, laptop, reports this.");
    expect(topic.meaning).toContain(notificationTopic("vault_sync").meaning);
  });

  test("explains every key that Eva writes in the history", () => {
    const keys = [
      "vault_sync",
      "update",
      "update_held_back",
      "engine_update",
      "engine_login:claude-code",
      "default_engine",
      "default_engine_restart",
      "schedule:lunch",
      "schedule_card:lunch",
      "template_alignment",
      "vault_ahead",
      "machine_ahead",
      "migration_failed:vault",
      "unclean_exit",
      "telegram_poll",
    ];
    for (const key of keys) expect(notificationTopic(key).title).not.toBe("Notification");
  });

  test("gives a plain topic to a key it does not know", () => {
    expect(notificationTopic("something_new").title).toBe("Notification");
    expect(notificationTopic("machine:laptop").title).toBe("Notification");
  });
});

describe("sameProblemEntries", () => {
  test("lists every entry of the same key, newest first by seq", () => {
    const entries = [entry(1, "a", "warn"), entry(2, "b", "news"), entry(3, "a", "resolved"), entry(4, "a", "warn")];
    expect(sameProblemEntries(entries, "a").map((kept) => kept.seq)).toEqual([4, 3, 1]);
  });
});

describe("entryState", () => {
  test("says whether the problem of an entry is still open or solved", () => {
    expect(entryState(entry(1, "a", "warn"), new Set(["a"]))).toBe("open");
    expect(entryState(entry(1, "a", "resolved"), new Set(["a"]))).toBe("open");
    expect(entryState(entry(1, "a", "error"), new Set())).toBe("solved");
    expect(entryState(entry(1, "a", "resolved"), new Set())).toBe("solved");
  });

  test("gives news no state: it is no problem", () => {
    expect(entryState(entry(1, "a", "news"), new Set(["a"]))).toBeNull();
  });

  test("gives a one-off problem no state: it is never open, but not solved either", () => {
    expect(entryState(entry(1, "migration_failed:vault", "error"), new Set())).toBeNull();
    expect(entryState(entry(1, "unclean_exit", "warn"), new Set())).toBeNull();
  });
});
