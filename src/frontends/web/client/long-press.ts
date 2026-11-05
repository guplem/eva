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
  private readonly onMoveAway: (target: T) => void;
  private press: { readonly target: T; readonly at: Point; readonly stop: () => void } | null;
  /** The press that held, while its finger is still down. */
  private held: { readonly target: T; readonly at: Point } | null;
  private dropClickUntil: number;

  /** `onMoveAway` runs when the finger of a press that held moves away, as in a drag. */
  constructor(
    schedule: Schedule,
    now: () => number,
    onHold: (target: T) => void,
    onMoveAway: (target: T) => void = () => undefined,
  ) {
    this.schedule = schedule;
    this.now = now;
    this.onHold = onHold;
    this.onMoveAway = onMoveAway;
    this.press = null;
    this.held = null;
    this.dropClickUntil = 0;
  }

  down(target: T, at: Point): void {
    this.stop();
    this.held = null;
    const stop = this.schedule(() => this.hold(), longPressMs);
    this.press = { target, at, stop };
  }

  move(at: Point): void {
    const start = this.press?.at ?? this.held?.at;
    if (start === undefined || Math.hypot(at.x - start.x, at.y - start.y) <= longPressSlop) return;
    this.stop();
    const held = this.held;
    this.held = null;
    if (held !== null) this.onMoveAway(held.target);
  }

  /** The finger lifts. That lift ends in a click, which a long press must not pass on. */
  up(): void {
    this.stop();
    if (this.held !== null) this.dropClickUntil = this.now() + clickAfterLiftMs;
    this.held = null;
  }

  /** The browser took the touch, for example to scroll: no click follows. */
  cancel(): void {
    this.stop();
    this.held = null;
  }

  /**
   * Android sends a contextmenu event on a long press. It can come before the timer ends: the press
   * then holds at once. It can also come later, while the finger is still down. False when no press
   * waits or holds, so the event is not this press.
   */
  holdNow(): boolean {
    if (this.press !== null) this.hold();
    return this.held !== null;
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
    this.held = { target: press.target, at: press.at };
    this.onHold(press.target);
  }

  private stop(): void {
    this.press?.stop();
    this.press = null;
  }
}
