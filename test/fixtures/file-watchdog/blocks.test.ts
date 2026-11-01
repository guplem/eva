/** A file whose test blocks its thread for good, as a Bun.spawnSync that never returns does (#742). */
import { test } from "bun:test";

test("blocks the thread for good", () => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
});
