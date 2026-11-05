/**
 * A long press: a touch that rests on an element. A phone has no hover and no right click, so a long
 * press opens the context menu (`Menu.tsx`) and shows a tooltip (`Tooltip.tsx`), as in a phone's own apps.
 */

/** A touch that rests this long is a long press. */
export const longPressMs = 500;
/** A click this soon after the finger of a long press lifts is that press. */
export const clickAfterLiftMs = 400;
/** A finger that moves further than this scrolls, so the long press stops. */
export const longPressSlop = 10;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Starts a timer and gives the function that stops it. A test gives a fake. */
export type Schedule = (run: () => void, ms: number) => () => void;

/** One touch at a time: down, then moves, then up or cancel. */
export class LongPress<T> {
  private readonly schedule: Schedule;
  private readonly now: () => number;
  private readonly onHold: (target: T) => void;
  private press: { readonly target: T; readonly at: Point; readonly stop: () => void } | null;
  private held: boolean;
  private dropClickUntil: number;

  constructor(schedule: Schedule, now: () => number, onHold: (target: T) => void) {
    this.schedule = schedule;
    this.now = now;
    this.onHold = onHold;
    this.press = null;
    this.held = false;
    this.dropClickUntil = 0;
  }

  down(target: T, at: Point): void {
    this.stop();
    this.held = false;
    const stop = this.schedule(() => this.hold(), longPressMs);
    this.press = { target, at, stop };
  }

  move(at: Point): void {
    const start = this.press?.at;
    if (start === undefined) return;
    if (Math.hypot(at.x - start.x, at.y - start.y) > longPressSlop) this.stop();
  }

  /** The finger lifts. That lift ends in a click, which a long press must not pass on. */
  up(): void {
    this.stop();
    if (this.held) this.dropClickUntil = this.now() + clickAfterLiftMs;
    this.held = false;
  }

  /** The browser took the touch, for example to scroll: no click follows. */
  cancel(): void {
    this.stop();
    this.held = false;
  }

  /**
   * Android sends a contextmenu event on a long press, before the timer ends. The press then holds
   * at once. False when no press waits, so the event is not this press.
   */
  holdNow(): boolean {
    if (this.press === null) return false;
    this.hold();
    return true;
  }

  /** True once for the click that ends a long press. Only a click right after the lift counts. */
  dropsClick(): boolean {
    if (this.now() >= this.dropClickUntil) return false;
    this.dropClickUntil = 0;
    return true;
  }

  private hold(): void {
    const press = this.press;
    if (press === null) return;
    this.stop();
    this.held = true;
    this.onHold(press.target);
  }

  private stop(): void {
    this.press?.stop();
    this.press = null;
  }
}
