/** The clock seam. Tests pass a fake; production uses the system clock. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** A counter that only grows, for ordering events (lesson 83: a timestamp alone can tie). */
export class SequenceCounter {
  private last: number;

  constructor() {
    this.last = 0;
  }

  next(): number {
    this.last += 1;
    return this.last;
  }

  /** The last number given, or 0 before the first. */
  current(): number {
    return this.last;
  }
}
