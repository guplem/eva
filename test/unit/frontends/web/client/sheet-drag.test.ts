import { describe, expect, test } from "bun:test";
import { dragStart, releaseOf, sheetOffset, SheetDrag } from "../../../../../src/frontends/web/client/sheet-drag.ts";

describe("sheetOffset", () => {
  test("a drag down moves the sheet with the finger", () => {
    expect(sheetOffset(0)).toBe(0);
    expect(sheetOffset(120)).toBe(120);
  });

  test("a drag up stretches the sheet a little and never past a limit", () => {
    expect(sheetOffset(-20)).toBeLessThan(0);
    expect(sheetOffset(-20)).toBeGreaterThan(-20);
    expect(sheetOffset(-2000)).toBeGreaterThanOrEqual(-24);
    expect(sheetOffset(-200)).toBeLessThan(sheetOffset(-20));
  });
});

describe("releaseOf", () => {
  test("a long drag down closes the sheet", () => {
    expect(releaseOf({ distance: 150, velocity: 0, height: 400 })).toBe("close");
  });

  test("a short slow drag springs back", () => {
    expect(releaseOf({ distance: 60, velocity: 0.1, height: 400 })).toBe("stay");
  });

  test("a fast flick down closes the sheet, also when it is short", () => {
    expect(releaseOf({ distance: 40, velocity: 0.8, height: 400 })).toBe("close");
  });

  test("a tiny flick or a drag up springs back", () => {
    expect(releaseOf({ distance: 8, velocity: 2, height: 400 })).toBe("stay");
    expect(releaseOf({ distance: -80, velocity: -1, height: 400 })).toBe("stay");
  });

  test("a tall sheet closes before the finger crosses a quarter of the screen", () => {
    expect(releaseOf({ distance: 170, velocity: 0, height: 780 })).toBe("close");
  });
});

describe("dragStart", () => {
  test("waits until the finger moves enough to show a direction", () => {
    expect(dragStart({ dx: 2, dy: 3, fromHandle: true, atTop: true })).toBe("wait");
  });

  test("the handle area drags the sheet down and up", () => {
    expect(dragStart({ dx: 1, dy: 12, fromHandle: true, atTop: false })).toBe("drag");
    expect(dragStart({ dx: 1, dy: -12, fromHandle: true, atTop: false })).toBe("drag");
  });

  test("the content drags the sheet down only when it is scrolled to the top", () => {
    expect(dragStart({ dx: 0, dy: 12, fromHandle: false, atTop: true })).toBe("drag");
    expect(dragStart({ dx: 0, dy: 12, fromHandle: false, atTop: false })).toBe("skip");
    expect(dragStart({ dx: 0, dy: -12, fromHandle: false, atTop: true })).toBe("skip");
  });

  test("a sideways move is never a drag of the sheet", () => {
    expect(dragStart({ dx: 20, dy: 8, fromHandle: true, atTop: true })).toBe("skip");
  });
});

describe("SheetDrag", () => {
  test("measures the distance and the speed of the last moves", () => {
    const drag = new SheetDrag(100, 0);
    drag.move(110, 16);
    drag.move(200, 200);
    drag.move(260, 250);
    expect(drag.distance).toBe(160);
    // The speed of the last 100 ms: from 200 at 200 ms to 260 at 250 ms.
    expect(drag.velocity).toBeCloseTo(60 / 50);
  });

  test("a finger that stops before it lets go has no speed", () => {
    const drag = new SheetDrag(0, 0);
    drag.move(80, 50);
    drag.move(80, 400);
    expect(drag.velocity).toBe(0);
  });
});
