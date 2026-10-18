import { describe, expect, test } from "bun:test";
import type { EngineEventPayload } from "../../../src/shared/events.ts";
import { describeUsageLimit, hasReset } from "../../../src/shared/usage-limit.ts";

type UsageLimit = Extract<EngineEventPayload, { kind: "usage_limit" }>;

function limit(overrides: Partial<UsageLimit> = {}): UsageLimit {
  return {
    kind: "usage_limit",
    status: "warning",
    window: "five_hour",
    usedPercent: 86,
    resetsAt: "2026-10-18T12:30:00.000Z",
    ...overrides,
  };
}

const now = new Date("2026-10-18T09:00:00.000Z");

describe("describeUsageLimit", () => {
  test("a warning says how much of the window is used, and the reset time in the time zone", () => {
    expect(describeUsageLimit(limit(), now, "Europe/Madrid")).toBe(
      "You used 86% of your 5-hour usage limit. It resets at 14:30.",
    );
  });

  test("a refusal says the limit is reached", () => {
    expect(describeUsageLimit(limit({ status: "rejected", window: "seven_day" }), now, "UTC")).toBe(
      "You reached your weekly usage limit. It resets at 12:30.",
    );
  });

  test("a reset on another day names the day", () => {
    const later = limit({ status: "rejected", window: "seven_day_opus", resetsAt: "2026-10-21T08:00:00.000Z" });
    expect(describeUsageLimit(later, now, "UTC")).toBe(
      "You reached your weekly Opus usage limit. It resets on Wednesday 21 October at 08:00.",
    );
  });

  test("a line with no percent, no reset time and an unknown window still reads well", () => {
    expect(describeUsageLimit(limit({ window: "other", usedPercent: null, resetsAt: null }), now, "UTC")).toBe(
      "You are near your usage limit.",
    );
  });

  test("a reset time that is no time drops the reset part, never a crash", () => {
    expect(describeUsageLimit(limit({ resetsAt: "soon" }), now, "UTC")).toBe(
      "You used 86% of your 5-hour usage limit.",
    );
  });

  test("a limit has reset only after its reset time", () => {
    expect(hasReset(limit(), now)).toBe(false);
    expect(hasReset(limit(), new Date("2026-10-18T12:30:00.000Z"))).toBe(true);
    expect(hasReset(limit({ resetsAt: null }), now)).toBe(false);
  });

  test("a bad time zone falls back to the machine's own, never a crash", () => {
    expect(describeUsageLimit(limit(), now, "Not/AZone")).toStartWith("You used 86% of your 5-hour usage limit.");
  });
});
