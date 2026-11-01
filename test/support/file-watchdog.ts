/**
 * Ends a `bun test --parallel` worker whose test file runs too long (#742). A call that blocks the
 * thread, such as a `Bun.spawnSync` that never returns, stops every timer of the file. So Bun's
 * test timeout never fires, and the run waits for the CI job limit. A `Worker` has its own
 * thread and timers, so it still runs. It ends the process, and the coordinator reports the file
 * as crashed, by its name, and runs the other files.
 *
 * `bunfig.toml` loads this file before each test file. Bun stops the `Worker` of a finished file.
 */
import { afterAll } from "bun:test";

/** The slowest file takes about 75 seconds on Linux and some minutes on Windows. */
const defaultLimitMs = 10 * 60_000;

// Only a worker: the coordinator then names the file. A plain `bun test` shows its own progress.
if (process.env["BUN_TEST_WORKER_ID"] !== undefined) {
  // Only a test lowers the limit.
  const limitMs = Number(process.env["EVA_TEST_FILE_LIMIT_MS"] ?? defaultLimitMs);
  const source = `setTimeout(() => {
    process.stderr.write("This test file ran for more than ${String(limitMs)} ms. Its thread may be blocked (#742).\\n");
    process.kill(process.pid, "SIGKILL");
  }, ${String(limitMs)});`;
  const watchdog = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
  afterAll(() => {
    watchdog.terminate();
  });
}
