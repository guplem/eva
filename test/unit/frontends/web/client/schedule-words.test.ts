import { describe, expect, test } from "bun:test";
import {
  dayLine,
  dayNumbersOf,
  lastRunWords,
  nextRunWords,
  repeatWords,
  slotWords,
} from "../../../../../src/frontends/web/client/schedule-words.ts";

const everyDay = [0, 1, 2, 3, 4, 5, 6];
/** A Wednesday. */
const now = "2026-10-21T10:15";

describe("repeatWords", () => {
  test("says each common repeat in words, never in day codes", () => {
    expect(repeatWords("08:00", everyDay)).toBe("Every day at 08:00");
    expect(repeatWords("08:00", [1, 2, 3, 4, 5])).toBe("Weekdays at 08:00");
    expect(repeatWords("10:00", [0, 6])).toBe("Weekends at 10:00");
    expect(repeatWords("18:30", [5])).toBe("Fridays at 18:30");
    expect(repeatWords("09:00", [1, 5])).toBe("Mondays and Fridays at 09:00");
  });

  test("lists three or more days short, from Monday to Sunday", () => {
    expect(repeatWords("09:00", [1, 3, 5])).toBe("Mon, Wed and Fri at 09:00");
    expect(repeatWords("09:00", [0, 1, 6])).toBe("Mon, Sat and Sun at 09:00");
  });
});

describe("nextRunWords", () => {
  test("names today, tomorrow, a day of this week, or a date", () => {
    expect(nextRunWords("2026-10-21T18:30", now)).toBe("Today 18:30");
    expect(nextRunWords("2026-10-22T08:00", now)).toBe("Tomorrow 08:00");
    expect(nextRunWords("2026-10-27T09:00", now)).toBe("Tue 09:00");
    expect(nextRunWords("2026-10-28T09:00", now)).toBe("28 Oct 09:00");
    expect(nextRunWords("2027-01-01T07:00", now)).toBe("1 Jan 07:00");
  });

  test("says never when nothing comes", () => {
    expect(nextRunWords(null, now)).toBe("Never");
  });
});

describe("lastRunWords", () => {
  test("a run today, yesterday or before, in green", () => {
    expect(lastRunWords({ slot: "2026-10-21T08:00", failed: false }, now)).toEqual({ text: "Ran today", tone: "ok" });
    expect(lastRunWords({ slot: "2026-10-20T08:00", failed: false }, now)).toEqual({
      text: "Ran yesterday",
      tone: "ok",
    });
    expect(lastRunWords({ slot: "2026-10-16T18:30", failed: false }, now)).toEqual({
      text: "Ran · 16 Oct",
      tone: "ok",
    });
  });

  test("a failure in red, with its day", () => {
    expect(lastRunWords({ slot: "2026-10-21T08:00", failed: true }, now)).toEqual({
      text: "Failed today",
      tone: "bad",
    });
    expect(lastRunWords({ slot: "2026-10-20T08:00", failed: true }, now)).toEqual({
      text: "Failed yesterday",
      tone: "bad",
    });
    expect(lastRunWords({ slot: "2026-10-01T07:00", failed: true }, now)).toEqual({
      text: "Failed · 1 Oct",
      tone: "bad",
    });
  });

  test("no run yet in grey", () => {
    expect(lastRunWords(null, now)).toEqual({ text: "Not run yet", tone: "idle" });
  });
});

describe("slotWords", () => {
  test("says a slot with its weekday and date, and null as never", () => {
    expect(slotWords("2026-10-22T09:00")).toBe("Thu 22 Oct, 09:00");
    expect(slotWords(null)).toBe("Never");
  });
});

describe("dayNumbersOf", () => {
  test("reads the days of a setup card, and an unknown name as nothing", () => {
    expect(dayNumbersOf("sun, mon, fri")).toEqual([0, 1, 5]);
    expect(dayNumbersOf("mon, someday")).toEqual([1]);
  });
});

describe("dayLine", () => {
  const schedule = (name: string, at: string, days = everyDay): { name: string; at: string; days: number[] } => ({
    name,
    at,
    days,
  });

  test("places the time now and today's runs on the day, in time order", () => {
    const line = dayLine([schedule("Review", "18:30"), schedule("Summary", "06:00")], "2026-10-21T12:00");
    expect(line.now).toBe(0.5);
    expect(line.nowLabel).toBe("Now (12:00)");
    expect(line.runs).toEqual([
      {
        position: 360 / 1440,
        label: "06:00 Summary",
        title: "06:00 Summary",
        width: 1110 / 1440 - 360 / 1440,
        marks: [360 / 1440],
      },
      {
        position: 1110 / 1440,
        label: "18:30 Review",
        title: "18:30 Review",
        width: 1 - 1110 / 1440,
        marks: [1110 / 1440],
      },
    ]);
  });

  test("leaves out a schedule that does not run today", () => {
    expect(dayLine([schedule("Friday", "08:00", [5])], now).runs).toEqual([]);
  });

  test("leaves out a schedule that is off (#188)", () => {
    expect(dayLine([{ ...schedule("Paused", "08:00"), enabled: false }], now).runs).toEqual([]);
  });

  test("runs less than three hours apart share one pill, so no two pills cover each other", () => {
    const line = dayLine([schedule("Summary", "08:00"), schedule("News", "09:30"), schedule("Lunch", "13:00")], now);
    expect(line.runs.map((run) => [run.label, run.title])).toEqual([
      ["08:00 Summary +1", "08:00 Summary\n09:30 News"],
      ["13:00 Lunch", "13:00 Lunch"],
    ]);
    expect(line.runs[0]?.width).toBeCloseTo(5 / 24);
    // Each run of a shared pill keeps its own mark, so a hover shows when each one runs.
    expect(line.runs[0]?.marks).toEqual([480 / 1440, 570 / 1440]);
  });
});
