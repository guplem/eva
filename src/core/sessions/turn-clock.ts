/**
 * The time limits of one turn. The limit catches an engine that hangs. The time that the turn waits
 * for the person is not the engine's, so this clock stops while a permission or a question is open.
 * A running chat pauses the vault sync and the updates, so a cap of the whole turn, waits included,
 * keeps an unanswered question from holding them for good (#938).
 */
export interface ClockSeams {
  readonly now: () => number;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

export interface TurnClockOptions {
  /** The time that the engine may work, without the waits for the person. */
  readonly limitMs: number;
  /** The time of the whole turn, waits included. Null: no cap. */
  readonly capMs: number | null;
  readonly onLimit: () => void;
}

const realSeams: ClockSeams = {
  now: () => performance.now(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export class TurnClock {
  private remainingMs: number;
  private runningSince: number | null = null;
  private timer: unknown = null;
  private capTimer: unknown = null;
  private waits = 0;
  private stopped = false;

  private constructor(
    private readonly options: TurnClockOptions,
    private readonly seams: ClockSeams,
  ) {
    this.remainingMs = options.limitMs;
  }

  static start(options: TurnClockOptions, seams: ClockSeams = realSeams): TurnClock {
    const clock = new TurnClock(options, seams);
    if (options.capMs !== null) clock.capTimer = seams.setTimer(() => clock.reach(), options.capMs);
    clock.run();
    return clock;
  }

  /** A wait for the person starts. Several waits can be open at once. */
  pause(): void {
    this.waits += 1;
    if (this.waits > 1 || this.runningSince === null) return;
    this.remainingMs -= this.seams.now() - this.runningSince;
    this.halt();
  }

  /** A wait for the person ends. The clock runs again when no wait is open. */
  resume(): void {
    if (this.waits === 0) return;
    this.waits -= 1;
    if (this.waits === 0) this.run();
  }

  stop(): void {
    this.stopped = true;
    this.halt();
    if (this.capTimer !== null) this.seams.clearTimer(this.capTimer);
    this.capTimer = null;
  }

  private reach(): void {
    if (this.stopped) return;
    this.stop();
    this.options.onLimit();
  }

  private run(): void {
    if (this.stopped) return;
    this.runningSince = this.seams.now();
    this.timer = this.seams.setTimer(() => this.reach(), Math.max(0, this.remainingMs));
  }

  private halt(): void {
    this.runningSince = null;
    if (this.timer !== null) this.seams.clearTimer(this.timer);
    this.timer = null;
  }
}
