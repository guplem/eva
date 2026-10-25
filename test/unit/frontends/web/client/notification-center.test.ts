import { describe, expect, test } from "bun:test";
import type { HistoryEntry } from "../../../../../src/core/alerts/notification-history.ts";
import {
  dayLabel,
  historyGroups,
  shownNeeds,
  timeLabel,
} from "../../../../../src/frontends/web/client/notification-center.ts";

// Local times, so the test passes in any time zone.
const now = new Date(2026, 9, 25, 15, 30);
const at = (day: number, hour: number): string => new Date(2026, 9, day, hour, 5).toISOString();

function entry(seq: number, level: HistoryEntry["level"], day: number, read = false): HistoryEntry {
  return { seq, key: `k${String(seq)}`, level, message: `m${String(seq)}`, at: at(day, 9), read };
}

describe("dayLabel and timeLabel", () => {
  test("names today and yesterday, and dates older days", () => {
    expect(dayLabel(at(25, 9), now)).toBe("Today");
    expect(dayLabel(at(24, 23), now)).toBe("Yesterday");
    expect(dayLabel(at(20, 9), now)).toBe("Tue 20 Oct");
  });

  test("gives the hour and minute, and a weekday for an older day", () => {
    expect(timeLabel(at(25, 9), now)).toBe("09:05");
    expect(timeLabel(at(24, 18), now)).toBe("Yesterday, 18:05");
    expect(timeLabel(at(20, 7), now)).toBe("Tue 20 Oct, 07:05");
  });
});

describe("historyGroups", () => {
  const entries = [entry(1, "warn", 20, true), entry(2, "resolved", 24), entry(3, "news", 25), entry(4, "error", 25)];

  test("lists the newest first, grouped by day", () => {
    expect(
      historyGroups(entries, "all", now).map((group) => [group.day, group.entries.map((kept) => kept.seq)]),
    ).toEqual([
      ["Today", [4, 3]],
      ["Yesterday", [2]],
      ["Tue 20 Oct", [1]],
    ]);
  });

  test("keeps only the unread entries, or only the problems", () => {
    expect(historyGroups(entries, "unread", now).flatMap((group) => group.entries.map((kept) => kept.seq))).toEqual([
      4, 3, 2,
    ]);
    expect(historyGroups(entries, "problems", now).flatMap((group) => group.entries.map((kept) => kept.seq))).toEqual([
      4, 1,
    ]);
  });
});

describe("shownNeeds", () => {
  test("the unread filter hides a problem that the person read; the other filters keep it", () => {
    const problems = [
      { key: "a", hidden: true },
      { key: "b", hidden: false },
    ];
    expect(shownNeeds(problems, "unread").map((problem) => problem.key)).toEqual(["b"]);
    expect(shownNeeds(problems, "all")).toHaveLength(2);
    expect(shownNeeds(problems, "problems")).toHaveLength(2);
  });
});
