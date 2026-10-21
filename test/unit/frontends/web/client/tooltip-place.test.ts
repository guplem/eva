import { describe, expect, test } from "bun:test";
import { placeTooltip, tooltipGap, tooltipMargin } from "../../../../../src/frontends/web/client/tooltip-place.ts";

const viewport = { width: 1000, height: 800 };
const tip = { width: 100, height: 30 };

describe("placeTooltip", () => {
  test("a tooltip sits above the centre of its element", () => {
    const anchor = { left: 400, top: 400, width: 40, height: 40 };
    expect(placeTooltip(anchor, tip, viewport)).toEqual({ left: 370, top: 400 - tooltipGap - 30, side: "above" });
  });

  test("a tooltip goes below an element at the top of the screen", () => {
    const anchor = { left: 400, top: 10, width: 40, height: 40 };
    expect(placeTooltip(anchor, tip, viewport)).toEqual({ left: 370, top: 50 + tooltipGap, side: "below" });
  });

  test("a tooltip stays inside the screen at the left and the right edges", () => {
    // A small mark sits in the corner of the screen, as in the bug report.
    const corner = { left: 2, top: 760, width: 12, height: 12 };
    expect(placeTooltip(corner, tip, viewport).left).toBe(tooltipMargin);
    const right = { left: 990, top: 400, width: 10, height: 10 };
    expect(placeTooltip(right, tip, viewport).left).toBe(1000 - tooltipMargin - 100);
  });

  test("a tooltip wider than the screen starts at the margin", () => {
    const anchor = { left: 100, top: 400, width: 10, height: 10 };
    expect(placeTooltip(anchor, { width: 2000, height: 30 }, viewport).left).toBe(tooltipMargin);
  });

  test("a tooltip can sit at the right of its element, as in the nav rail", () => {
    const anchor = { left: 10, top: 100, width: 40, height: 40 };
    expect(placeTooltip(anchor, tip, viewport, "right")).toEqual({ left: 50 + tooltipGap, top: 105, side: "right" });
  });

  test("a tooltip goes above when the right has no room", () => {
    const anchor = { left: 950, top: 400, width: 40, height: 40 };
    expect(placeTooltip(anchor, tip, viewport, "right").side).toBe("above");
  });

  test("a tooltip at the right stays inside the screen from top to bottom", () => {
    const anchor = { left: 10, top: 790, width: 10, height: 10 };
    expect(placeTooltip(anchor, tip, viewport, "right").top).toBe(800 - tooltipMargin - 30);
  });
});
