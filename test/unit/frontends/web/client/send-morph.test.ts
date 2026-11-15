import { describe, expect, test } from "bun:test";
import {
  boxAt,
  cornersAt,
  crossFade,
  durationMs,
  springAt,
} from "../../../../../src/frontends/web/client/send-morph.ts";

describe("springAt", () => {
  test("starts at the start and ends exactly at the end", () => {
    expect(springAt(0)).toBe(0);
    expect(springAt(1)).toBe(1);
  });

  test("clamps a time outside the morph", () => {
    expect(springAt(-0.5)).toBe(0);
    expect(springAt(1.5)).toBe(1);
  });

  test("reaches the end early and passes it only a little, so the bubble settles with a soft bounce", () => {
    expect(springAt(0.5)).toBeGreaterThan(0.95);
    const samples = Array.from({ length: 101 }, (_, step) => springAt(step / 100));
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(Math.max(...samples)).toBeLessThan(1.05);
  });
});

describe("boxAt", () => {
  const from = { x: 0, y: 500, width: 400, height: 120 };
  const to = { x: 200, y: 100, width: 180, height: 48 };

  test("gives the start box at 0 and the end box at 1", () => {
    expect(boxAt(from, to, 0)).toEqual(from);
    expect(boxAt(from, to, 1)).toEqual(to);
  });

  test("goes the same share of the way on each side", () => {
    expect(boxAt(from, to, 0.5)).toEqual({ x: 100, y: 300, width: 290, height: 84 });
  });

  test("never gives a negative size when the spring passes the end", () => {
    const box = boxAt({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 0 }, 1.04);
    expect(box.width).toBe(0);
    expect(box.height).toBe(0);
  });
});

describe("cornersAt", () => {
  test("turns the round corners of the box into the corners of the bubble, with its tail", () => {
    const box = ["28px", "28px", "28px", "28px"] as const;
    const bubble = ["24px", "24px", "8px", "24px"] as const;
    expect(cornersAt(box, bubble, 0)).toBe("28px 28px 28px 28px");
    expect(cornersAt(box, bubble, 1)).toBe("24px 24px 8px 24px");
    expect(cornersAt(box, bubble, 0.5)).toBe("26px 26px 18px 26px");
  });

  test("reads a corner that is not a number of pixels as 0", () => {
    expect(cornersAt(["auto", "0", "", "4px"], ["8px", "8px", "8px", "8px"], 0)).toBe("0px 0px 0px 4px");
  });
});

describe("crossFade", () => {
  test("shows only the box at the start and only the bubble at the end", () => {
    expect(crossFade(0)).toEqual({ box: 1, boxText: 1, bubble: 0 });
    expect(crossFade(1)).toEqual({ box: 0, boxText: 0, bubble: 1 });
  });

  test("lets the box text go before the bubble text comes, so the two never blur together for long", () => {
    expect(crossFade(0.2).bubble).toBe(0);
    expect(crossFade(0.42).boxText).toBe(0);
    expect(crossFade(0.62).bubble).toBe(1);
  });

  test("keeps the box surface whole until the bubble covers it, so the chat never shows through", () => {
    expect(crossFade(0.6).box).toBe(1);
    expect(crossFade(0.9).box).toBe(0);
  });
});

describe("durationMs", () => {
  test("reads a token in milliseconds or in seconds, as the bundler may shorten it", () => {
    expect(durationMs("560ms")).toBe(560);
    expect(durationMs(" .56s ")).toBe(560);
    expect(durationMs("0.4s")).toBe(400);
  });

  test("gives null for a token that the page lacks or that is not a time", () => {
    expect(durationMs("")).toBeNull();
    expect(durationMs("fast")).toBeNull();
    expect(durationMs("12px")).toBeNull();
  });
});
