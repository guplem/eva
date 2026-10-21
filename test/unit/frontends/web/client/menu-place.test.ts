import { describe, expect, test } from "bun:test";
import { menuMargin, placeMenu } from "../../../../../src/frontends/web/client/menu-place.ts";

const viewport = { width: 1000, height: 800 };
const menu = { width: 200, height: 150 };

describe("placeMenu", () => {
  test("a menu opens with its top left corner at the pointer", () => {
    expect(placeMenu({ x: 300, y: 200 }, menu, viewport)).toEqual({ left: 300, top: 200 });
  });

  test("a menu near the right edge opens to the left of the pointer", () => {
    expect(placeMenu({ x: 900, y: 200 }, menu, viewport).left).toBe(700);
  });

  test("a menu near the bottom edge opens above the pointer", () => {
    expect(placeMenu({ x: 300, y: 750 }, menu, viewport).top).toBe(600);
  });

  test("a menu that fits on neither side stays inside the screen", () => {
    // A phone is narrow: the pointer is in the middle, and the menu is as wide as the screen.
    const phone = { width: 320, height: 640 };
    const place = placeMenu({ x: 160, y: 300 }, { width: 300, height: 150 }, phone);
    expect(place.left).toBeGreaterThanOrEqual(menuMargin);
    expect(place.left + 300).toBeLessThanOrEqual(320 - menuMargin);
  });

  test("a menu larger than the screen starts at the margin", () => {
    expect(placeMenu({ x: 10, y: 10 }, { width: 2000, height: 2000 }, viewport)).toEqual({
      left: menuMargin,
      top: menuMargin,
    });
  });
});
