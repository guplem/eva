/** The bot tests fake the sleep, so they reach the real one only by chance: these pin it on their own. */
import { describe, expect, test } from "bun:test";
import { sleepUntilAborted } from "../../../../src/frontends/telegram/telegram-poll.ts";

describe("sleepUntilAborted", () => {
  test("waits for the time when nothing stops it", async () => {
    const started = Date.now();
    await sleepUntilAborted(20, new AbortController().signal);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  test("returns at once when the signal aborts during the wait", async () => {
    const stop = new AbortController();
    const sleeping = sleepUntilAborted(60_000, stop.signal);
    stop.abort();
    await sleeping;
  });

  test("returns at once when the signal has already aborted", async () => {
    const stop = new AbortController();
    stop.abort();
    await sleepUntilAborted(60_000, stop.signal);
  });
});
