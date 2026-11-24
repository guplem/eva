/**
 * Tests for the time limit of one unit test file (#1043).
 * The file has no `src/` twin: it tests `scripts/test-with-time-limit.ts`, which the checks run.
 */
import { describe, expect, test } from "bun:test";
import { fileLimitMs, filesOverLimit, parseTimings } from "../../scripts/test-with-time-limit.ts";

describe("filesOverLimit", () => {
  test("names each file over the limit, slowest first", () => {
    const timings = { "test/unit/a.test.ts": 50_000, "test/unit/b.test.ts": 10_000, "test/unit/c.test.ts": 90_000 };
    expect(filesOverLimit(timings, 40_000)).toEqual([
      { file: "test/unit/c.test.ts", ms: 90_000 },
      { file: "test/unit/a.test.ts", ms: 50_000 },
    ]);
  });

  test("a file at the limit passes", () => {
    expect(filesOverLimit({ "test/unit/a.test.ts": 40_000 }, 40_000)).toEqual([]);
  });
});

describe("fileLimitMs", () => {
  test("Windows gets a higher limit, because git is much slower there", () => {
    expect(fileLimitMs("win32")).toBeGreaterThan(fileLimitMs("linux"));
    expect(fileLimitMs("darwin")).toBe(fileLimitMs("linux"));
  });
});

describe("parseTimings", () => {
  test("reads the files of a Bun timings file", () => {
    expect(parseTimings('{ "version": 1, "files": { "test/unit/a.test.ts": 12 } }')).toEqual({
      "test/unit/a.test.ts": 12,
    });
  });

  test("a file that Bun did not write gives no timings, so the check cannot pass by mistake", () => {
    expect(() => parseTimings("not json")).toThrow();
    expect(() => parseTimings('{ "version": 1 }')).toThrow();
    expect(() => parseTimings('{ "version": 1, "files": { "a": "slow" } }')).toThrow();
  });
});
