import { describe, expect, test } from "bun:test";
import {
  autoTextHeight,
  foldsToOneRow,
  shortTouchWindow,
  shortWindow,
} from "../../../../../src/frontends/web/client/composer-layout.ts";

describe("foldsToOneRow", () => {
  test("a computer with a tall window keeps the settings row", () => {
    expect(foldsToOneRow({ visibleHeight: 720, touch: false, phoneSized: false })).toBe(false);
  });

  test("a window lower than the short limit folds the box", () => {
    expect(foldsToOneRow({ visibleHeight: shortWindow - 1, touch: false, phoneSized: false })).toBe(true);
    expect(foldsToOneRow({ visibleHeight: shortWindow, touch: false, phoneSized: false })).toBe(false);
  });

  test("a laptop at 150 % scaling, about 600 px high under its bars, keeps the row", () => {
    expect(foldsToOneRow({ visibleHeight: 600, touch: false, phoneSized: false })).toBe(false);
  });

  test("a touch screen folds below a higher limit, since its keyboard takes half the window", () => {
    expect(foldsToOneRow({ visibleHeight: shortTouchWindow - 1, touch: true, phoneSized: false })).toBe(true);
    expect(foldsToOneRow({ visibleHeight: shortTouchWindow, touch: true, phoneSized: false })).toBe(false);
  });

  test("a phone folds the box even with the keyboard down, so the row never flashes while it opens", () => {
    expect(foldsToOneRow({ visibleHeight: 812, touch: true, phoneSized: true })).toBe(true);
  });

  test("a tall tablet keeps the row, and a narrow window with a mouse does too", () => {
    expect(foldsToOneRow({ visibleHeight: 1000, touch: true, phoneSized: false })).toBe(false);
    expect(foldsToOneRow({ visibleHeight: 812, touch: false, phoneSized: true })).toBe(false);
  });
});

describe("autoTextHeight", () => {
  test("the text takes about a quarter of the visible window, in whole lines", () => {
    // 0.28 × 720 = 201.6, so 9 lines of 21 px.
    expect(autoTextHeight(720, 21)).toBe(9 * 21);
  });

  test("a low window still shows 3 lines", () => {
    expect(autoTextHeight(300, 24)).toBe(3 * 24);
  });

  test("a tall window shows 10 lines at most", () => {
    expect(autoTextHeight(2000, 21)).toBe(10 * 21);
  });

  test("a line height that the browser did not give falls back to the usual line", () => {
    expect(autoTextHeight(720, Number.NaN)).toBe(9 * 21);
    expect(autoTextHeight(720, 0)).toBe(9 * 21);
  });
});

describe("autoTextHeight with no window height", () => {
  test("a window height that the browser did not give still shows 3 lines", () => {
    expect(autoTextHeight(Number.NaN, 21)).toBe(3 * 21);
  });
});
