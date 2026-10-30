import { describe, expect, test } from "bun:test";
import {
  composerHeightRange,
  heightShare,
  keptHeightShare,
} from "../../../../../src/frontends/web/client/composer-height.ts";

describe("composer height", () => {
  test("a drag keeps its height as a share of the window", () => {
    expect(heightShare(400, 800)).toBe(0.5);
  });

  test("a share stays inside the range, so the box never covers the whole chat", () => {
    expect(heightShare(790, 800)).toBe(composerHeightRange.max);
    expect(heightShare(1, 800)).toBe(composerHeightRange.min);
  });

  test("a stored share that is missing or broken gives the usual height", () => {
    expect(keptHeightShare(null)).toBeNull();
    expect(keptHeightShare("tall")).toBeNull();
    expect(keptHeightShare("0.3")).toBe(0.3);
    expect(keptHeightShare("5")).toBe(composerHeightRange.max);
  });
});
