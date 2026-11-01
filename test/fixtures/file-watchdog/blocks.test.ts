/** A file whose test blocks its thread, as a Bun.spawnSync that never returns does (#742). */
import { test } from "bun:test";

test("blocks the thread for a minute", () => {
  // Not for good: a run without the watchdog still ends.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
});
