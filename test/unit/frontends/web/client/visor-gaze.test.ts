import { describe, expect, test } from "bun:test";
import { gazeDelayMs, gazeOffset, maxGaze } from "../../../../../src/frontends/web/client/visor-gaze.ts";

describe("gazeOffset", () => {
  test("a pointer on the visor's centre keeps the eyes centred", () => {
    expect(gazeOffset(0, 0)).toEqual({ x: 0, y: 0 });
  });

  test("the eyes move toward the pointer", () => {
    const right = gazeOffset(300, 0);
    expect(right.x).toBeGreaterThan(0);
    expect(right.y).toBe(0);
    const upLeft = gazeOffset(-200, -200);
    expect(upLeft.x).toBeLessThan(0);
    expect(upLeft.y).toBeLessThan(0);
  });

  test("a far pointer moves the eyes further than a near one", () => {
    expect(gazeOffset(800, 0).x).toBeGreaterThan(gazeOffset(80, 0).x);
  });

  test("the eyes never leave the visor", () => {
    const far = gazeOffset(100_000, 100_000);
    expect(Math.abs(far.x)).toBeLessThanOrEqual(maxGaze.x);
    expect(Math.abs(far.y)).toBeLessThanOrEqual(maxGaze.y);
    expect(Math.abs(gazeOffset(-100_000, 0).x)).toBeLessThanOrEqual(maxGaze.x);
  });
});

test("EVE starts to follow the pointer after 5 seconds", () => {
  expect(gazeDelayMs).toBe(5000);
});
