import { describe, expect, test } from "bun:test";
import {
  regionalLocale,
  clockTime,
  hourLabel,
  isClock,
  isWeekStart,
  slotTime,
  weekOrder,
  zonedClockTime,
} from "../../../src/shared/time-format.ts";

describe("clockTime", () => {
  test("a 24-hour clock writes two digits for each part", () => {
    expect(clockTime(9, 5, "24h")).toBe("09:05");
    expect(clockTime(18, 30, null)).toBe("18:30");
  });

  test("a 12-hour clock writes the hour with no leading zero and AM or PM", () => {
    expect(clockTime(0, 15, "12h")).toBe("12:15 AM");
    expect(clockTime(9, 5, "12h")).toBe("9:05 AM");
    expect(clockTime(12, 0, "12h")).toBe("12:00 PM");
    expect(clockTime(18, 30, "12h")).toBe("6:30 PM");
  });
});

describe("slotTime and hourLabel", () => {
  test("a stored HH:MM text shows in the clock form", () => {
    expect(slotTime("18:30", "12h")).toBe("6:30 PM");
    expect(slotTime("18:30", "24h")).toBe("18:30");
  });

  test("a text that is not a time stays as it is", () => {
    expect(slotTime("soon", "12h")).toBe("soon");
  });

  test("an hour label is short in the 12-hour form", () => {
    expect(hourLabel(0, "12h")).toBe("12 AM");
    expect(hourLabel(18, "12h")).toBe("6 PM");
    expect(hourLabel(24, "12h")).toBe("12 AM");
    expect(hourLabel(6, "24h")).toBe("06:00");
  });
});

describe("zonedClockTime", () => {
  test("a moment shows in the given zone and clock", () => {
    const at = new Date("2026-10-18T12:30:00.000Z");
    expect(zonedClockTime(at, "Europe/Madrid", "12h")).toBe("2:30 PM");
    expect(zonedClockTime(at, "Europe/Madrid", "24h")).toBe("14:30");
  });
});

describe("weekOrder", () => {
  test("Monday is first when the week start is not set", () => {
    expect(weekOrder(null)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  test("the week starts on the setting's day", () => {
    expect(weekOrder("sunday")).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekOrder("saturday")).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });
});

describe("the value checks", () => {
  test("only the stored values pass", () => {
    expect(isClock("12h")).toBe(true);
    expect(isClock("12")).toBe(false);
    expect(isWeekStart("sunday")).toBe(true);
    expect(isWeekStart("Sunday")).toBe(false);
  });
});

describe("regionalLocale", () => {
  test("takes the first browser locale with a region, else the first one", () => {
    expect(regionalLocale(["es", "es-ES", "en-US"])).toBe("es-ES");
    expect(regionalLocale(["en", "de"])).toBe("en");
    expect(regionalLocale([])).toBeUndefined();
  });
});
