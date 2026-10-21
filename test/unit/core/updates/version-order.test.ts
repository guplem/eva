import { describe, expect, test } from "bun:test";
import { isNewerVersion } from "../../../../src/core/updates/version-order.ts";

describe("isNewerVersion", () => {
  test("versions compare by number, with or without a v", () => {
    expect(isNewerVersion("v0.2.0", "0.1.9")).toBe(true);
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1", "0.1.1")).toBe(false);
    expect(isNewerVersion("1.0.0-beta", "0.9.0")).toBe(true);
  });
});
