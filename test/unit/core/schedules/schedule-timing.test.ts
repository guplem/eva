import { describe, expect, test } from "bun:test";
import { parseScheduleEntry, type Schedule } from "../../../../src/core/schedules/schedule-definitions.ts";
import { dueSlot, nextSlot, wallClockOf } from "../../../../src/core/schedules/schedule-timing.ts";

function schedule(at: string, days?: string[]): Schedule {
  return parseScheduleEntry(
    { id: "s", name: "S", at, text: "hi", ...(days === undefined ? {} : { days }) },
    1,
  ) as Schedule;
}

describe("wallClockOf (lesson 68)", () => {
  test("reads the wall clock of the configured time zone, not of the machine", () => {
    const moment = new Date("2026-07-01T05:30:00Z");
    expect(wallClockOf(moment, "UTC")).toBe("2026-07-01T05:30");
    expect(wallClockOf(moment, "Europe/Madrid")).toBe("2026-07-01T07:30");
    expect(wallClockOf(moment, "America/New_York")).toBe("2026-07-01T01:30");
  });

  test("midnight reads as 00, never 24", () => {
    expect(wallClockOf(new Date("2026-07-01T00:05:00Z"), "UTC")).toBe("2026-07-01T00:05");
  });
});

describe("dueSlot", () => {
  const seenLongAgo = { firstSeen: "2026-01-01T00:00", lastFired: null };

  test("fires at the time, and catches up a miss within one hour", () => {
    expect(dueSlot(schedule("07:30"), seenLongAgo, "2026-07-01T07:29")).toBeNull();
    expect(dueSlot(schedule("07:30"), seenLongAgo, "2026-07-01T07:30")).toBe("2026-07-01T07:30");
    expect(dueSlot(schedule("07:30"), seenLongAgo, "2026-07-01T08:29")).toBe("2026-07-01T07:30");
    expect(dueSlot(schedule("07:30"), seenLongAgo, "2026-07-01T08:30")).toBeNull();
  });

  test("a slot that already fired does not fire again", () => {
    const fired = { firstSeen: "2026-01-01T00:00", lastFired: "2026-07-01T07:30" };
    expect(dueSlot(schedule("07:30"), fired, "2026-07-01T07:45")).toBeNull();
    expect(dueSlot(schedule("07:30"), fired, "2026-07-02T07:30")).toBe("2026-07-02T07:30");
  });

  test("the hour that repeats when the clocks go back fires once", () => {
    // 02:30 happens twice on that night; the second one reads the same slot text.
    const fired = { firstSeen: "2026-01-01T00:00", lastFired: "2026-10-25T02:30" };
    expect(dueSlot(schedule("02:30"), fired, "2026-10-25T02:30")).toBeNull();
  });

  test("a slot skipped when the clocks go forward still fires within the hour", () => {
    // 02:00 jumps to 03:00, so 02:30 never shows on the wall clock.
    expect(dueSlot(schedule("02:30"), seenLongAgo, "2026-03-29T03:00")).toBe("2026-03-29T02:30");
  });

  test("a schedule written after its time today waits for the next day", () => {
    const seen = { firstSeen: "2026-07-01T07:35", lastFired: null };
    expect(dueSlot(schedule("07:30"), seen, "2026-07-01T07:40")).toBeNull();
    expect(dueSlot(schedule("07:30"), seen, "2026-07-02T07:30")).toBe("2026-07-02T07:30");
  });

  test("a slot just before midnight is caught up just after it", () => {
    expect(dueSlot(schedule("23:50"), seenLongAgo, "2026-07-02T00:10")).toBe("2026-07-01T23:50");
  });

  test("only the listed days fire", () => {
    // 2026-07-01 is a Wednesday.
    expect(dueSlot(schedule("07:30", ["mon"]), seenLongAgo, "2026-07-01T07:30")).toBeNull();
    expect(dueSlot(schedule("07:30", ["wed"]), seenLongAgo, "2026-07-01T07:30")).toBe("2026-07-01T07:30");
  });
});

describe("nextSlot", () => {
  test("is later today, or on the next listed day", () => {
    expect(nextSlot(schedule("07:30"), "2026-07-01T07:00")).toBe("2026-07-01T07:30");
    expect(nextSlot(schedule("07:30"), "2026-07-01T07:30")).toBe("2026-07-02T07:30");
    expect(nextSlot(schedule("07:30", ["mon"]), "2026-07-01T07:00")).toBe("2026-07-06T07:30");
  });
});
