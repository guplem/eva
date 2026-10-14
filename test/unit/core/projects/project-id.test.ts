import { describe, expect, test } from "bun:test";
import { formatProjectId, parseProjectId } from "../../../../src/core/projects/project-id.ts";

describe("parseProjectId", () => {
  test("reads a full id to the minute", () => {
    expect(parseProjectId("2025-03-02-1015-example-app")).toEqual({
      id: "2025-03-02-1015-example-app",
      created: { year: 2025, month: 3, day: 2, hour: 10, minute: 15 },
      precision: "minute",
      slug: "example-app",
    });
  });

  test("reads an id known only to the day, month or year", () => {
    expect(parseProjectId("2019-03-15-tool")?.precision).toBe("day");
    expect(parseProjectId("2019-03-tool")?.precision).toBe("month");
    expect(parseProjectId("2019-tool")).toMatchObject({ precision: "year", created: { year: 2019 }, slug: "tool" });
  });

  test("keeps a slug that starts with digits", () => {
    expect(parseProjectId("2018-10-08-1223-4utumn")?.slug).toBe("4utumn");
  });

  test("rejects a folder that is not a project id", () => {
    for (const name of [
      "_inventory.csv",
      "P93-old-style-name",
      "2025-13-01-1015-bad-month",
      "2025-03-02-2460-bad-time",
      "2025-03-02-1015-Upper",
      "2025-03-02-1015-",
    ]) {
      expect(parseProjectId(name)).toBeNull();
    }
  });
});

describe("formatProjectId", () => {
  test("writes the creation time to the minute and the slug", () => {
    expect(formatProjectId(new Date(2026, 9, 13, 15, 42), "Wall-I Rewrite")).toBe("2026-10-13-1542-wall-i-rewrite");
  });

  test("turns any name into lowercase words joined by hyphens", () => {
    expect(formatProjectId(new Date(2026, 0, 5, 9, 7), "  Café: Ñoño & co.  ")).toBe("2026-01-05-0907-cafe-nono-co");
  });

  test("refuses a name with no letters or digits", () => {
    expect(() => formatProjectId(new Date(2026, 0, 5, 9, 7), "!!!")).toThrow("letter or digit");
  });
});
