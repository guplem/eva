import { describe, expect, test } from "bun:test";
import { chatTime } from "../../../../../src/frontends/web/client/time-format.ts";

describe("chatTime", () => {
  const now = new Date(2026, 9, 19, 15, 30);

  test("today shows the time, this week the weekday, and older the day and month", () => {
    expect(chatTime(new Date(2026, 9, 19, 9, 5).toISOString(), now)).toBe("09:05");
    expect(chatTime(new Date(2026, 9, 18, 23, 59).toISOString(), now)).toBe("Sun");
    expect(chatTime(new Date(2026, 9, 13, 8, 0).toISOString(), now)).toBe("Tue");
    expect(chatTime(new Date(2026, 9, 12, 8, 0).toISOString(), now)).toBe("12 Oct");
    expect(chatTime(new Date(2025, 0, 2, 8, 0).toISOString(), now)).toBe("2 Jan 2025");
  });

  test("a bad time shows nothing", () => {
    expect(chatTime("not a time", now)).toBe("");
  });
});
