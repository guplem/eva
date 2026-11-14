/**
 * The time limit of one turn. The limit catches an engine that hangs. The time that the turn waits
 * for the person is not the engine's, so the clock stops while a permission or a question is open (#938).
 */
export interface ClockSeams {
  readonly now: () => number;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
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
  private waits = 0;
  private stopped = false;

  private constructor(
    limitMs: number,
    private readonly onLimit: () => void,
    private readonly seams: ClockSeams,
  ) {
    this.remainingMs = limitMs;
  }

  static start(limitMs: number, onLimit: () => void, seams: ClockSeams = realSeams): TurnClock {
    const clock = new TurnClock(limitMs, onLimit, seams);
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
  }

  private run(): void {
    if (this.stopped) return;
    this.runningSince = this.seams.now();
    this.timer = this.seams.setTimer(
      () => {
        this.stop();
        this.onLimit();
      },
      Math.max(0, this.remainingMs),
    );
  }

  private halt(): void {
    this.runningSince = null;
    if (this.timer !== null) this.seams.clearTimer(this.timer);
    this.timer = null;
  }
}
