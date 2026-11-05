import { describe, expect, test } from "bun:test";
import {
  clickAfterLiftMs,
  LongPress,
  longPressMs,
  longPressSlop,
} from "../../../../../src/frontends/web/client/long-press.ts";

/** A clock and a timer that the test moves by hand. */
function fakeTime(): {
  readonly now: () => number;
  readonly schedule: (run: () => void, ms: number) => () => void;
  readonly advance: (ms: number) => void;
} {
  let time = 0;
  let timers: { at: number; run: () => void }[] = [];
  return {
    now: () => time,
    schedule: (run, ms) => {
      const timer = { at: time + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
    advance: (ms) => {
      time += ms;
      const due = timers.filter((timer) => timer.at <= time);
      timers = timers.filter((timer) => timer.at > time);
      for (const timer of due) timer.run();
    },
  };
}

function setUp(): {
  readonly press: LongPress<string>;
  readonly held: string[];
  readonly time: ReturnType<typeof fakeTime>;
} {
  const time = fakeTime();
  const held: string[] = [];
  const press = new LongPress<string>(time.schedule, time.now, (target) => held.push(target));
  return { press, held, time };
}

describe("LongPress", () => {
  test("a touch that rests for the long press time holds its target", () => {
    const { press, held, time } = setUp();
    press.down("row", { x: 10, y: 10 });
    time.advance(longPressMs - 1);
    expect(held).toEqual([]);
    time.advance(1);
    expect(held).toEqual(["row"]);
  });

  test("a finger that lifts early holds nothing, and its click stays", () => {
    const { press, held, time } = setUp();
    press.down("row", { x: 10, y: 10 });
    time.advance(100);
    press.up();
    time.advance(longPressMs);
    expect(held).toEqual([]);
    expect(press.dropsClick()).toBe(false);
  });

  test("a finger that moves further than the slop scrolls, so the press stops", () => {
    const { press, held, time } = setUp();
    press.down("row", { x: 10, y: 10 });
    press.move({ x: 10, y: 10 + longPressSlop + 1 });
    time.advance(longPressMs);
    expect(held).toEqual([]);
  });

  test("a small move keeps the press", () => {
    const { press, held, time } = setUp();
    press.down("row", { x: 10, y: 10 });
    press.move({ x: 13, y: 14 });
    time.advance(longPressMs);
    expect(held).toEqual(["row"]);
  });

  test("the click right after the lift of a long press is dropped once", () => {
    const { press, time } = setUp();
    press.down("row", { x: 10, y: 10 });
    time.advance(longPressMs);
    press.up();
    expect(press.dropsClick()).toBe(true);
    expect(press.dropsClick()).toBe(false);
  });

  test("a later click, such as one from a keyboard, is not dropped", () => {
    const { press, time } = setUp();
    press.down("row", { x: 10, y: 10 });
    time.advance(longPressMs);
    press.up();
    time.advance(clickAfterLiftMs);
    expect(press.dropsClick()).toBe(false);
  });

  test("a cancelled touch drops no click", () => {
    const { press, time } = setUp();
    press.down("row", { x: 10, y: 10 });
    time.advance(longPressMs);
    press.cancel();
    press.up();
    expect(press.dropsClick()).toBe(false);
  });

  test("holdNow holds a waiting press at once, as the contextmenu event of Android asks", () => {
    const { press, held, time } = setUp();
    expect(press.holdNow()).toBe(false);
    press.down("row", { x: 10, y: 10 });
    time.advance(200);
    expect(press.holdNow()).toBe(true);
    expect(held).toEqual(["row"]);
    time.advance(longPressMs);
    expect(held).toEqual(["row"]);
    press.up();
    expect(press.dropsClick()).toBe(true);
  });

  test("a new touch stops the press of the one before", () => {
    const { press, held, time } = setUp();
    press.down("first", { x: 10, y: 10 });
    time.advance(200);
    press.down("second", { x: 50, y: 50 });
    time.advance(longPressMs);
    expect(held).toEqual(["second"]);
  });
});
