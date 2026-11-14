import { describe, expect, test } from "bun:test";
import { TurnClock } from "../../../../src/core/sessions/turn-clock.ts";

/** A clock that moves only when the test moves it, with timers that fire at their time. */
class FakeTime {
  now = 0;
  private timers: { at: number; run: () => void; id: number }[] = [];
  private nextId = 0;

  readonly seams = {
    now: (): number => this.now,
    setTimer: (run: () => void, ms: number): number => {
      this.nextId += 1;
      this.timers.push({ at: this.now + ms, run, id: this.nextId });
      return this.nextId;
    },
    clearTimer: (id: unknown): void => {
      this.timers = this.timers.filter((timer) => timer.id !== id);
    },
  };

  advance(ms: number): void {
    this.now += ms;
    const due = this.timers.filter((timer) => timer.at <= this.now);
    this.timers = this.timers.filter((timer) => timer.at > this.now);
    for (const timer of due) timer.run();
  }
}

describe("the clock of a turn (#938)", () => {
  test("reaches the limit when nobody waits for the person", () => {
    const time = new FakeTime();
    let reached = 0;
    TurnClock.start({ limitMs: 100, capMs: null, onLimit: () => (reached += 1) }, time.seams);
    time.advance(99);
    expect(reached).toBe(0);
    time.advance(1);
    expect(reached).toBe(1);
  });

  test("does not count the time that the turn waits for an answer", () => {
    const time = new FakeTime();
    let reached = 0;
    const clock = TurnClock.start({ limitMs: 100, capMs: null, onLimit: () => (reached += 1) }, time.seams);
    time.advance(60);
    clock.pause();
    time.advance(10_000);
    expect(reached).toBe(0);
    clock.resume();
    time.advance(39);
    expect(reached).toBe(0);
    time.advance(1);
    expect(reached).toBe(1);
  });

  test("runs again only when the last open wait ends", () => {
    const time = new FakeTime();
    let reached = 0;
    const clock = TurnClock.start({ limitMs: 100, capMs: null, onLimit: () => (reached += 1) }, time.seams);
    clock.pause();
    clock.pause();
    clock.resume();
    time.advance(1_000);
    expect(reached).toBe(0);
    clock.resume();
    time.advance(100);
    expect(reached).toBe(1);
  });

  test("reaches the cap of the whole turn even while it waits for an answer", () => {
    const time = new FakeTime();
    let reached = 0;
    const clock = TurnClock.start({ limitMs: 100, capMs: 1_000, onLimit: () => (reached += 1) }, time.seams);
    time.advance(50);
    clock.pause();
    time.advance(949);
    expect(reached).toBe(0);
    time.advance(1);
    expect(reached).toBe(1);
    clock.resume();
    time.advance(1_000);
    expect(reached).toBe(1);
  });

  test("a stopped clock never reaches the limit, even after a wait ends", () => {
    const time = new FakeTime();
    let reached = 0;
    const clock = TurnClock.start({ limitMs: 100, capMs: null, onLimit: () => (reached += 1) }, time.seams);
    clock.pause();
    clock.stop();
    clock.resume();
    time.advance(1_000);
    expect(reached).toBe(0);
  });
});
