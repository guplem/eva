/**
 * Ends a `bun test --parallel` worker whose test file runs too long (#742). A call that blocks the
 * thread, such as a `Bun.spawnSync` that never returns, stops every timer of the file. So Bun's
 * test timeout never fires, and the run waits for the CI job limit. A `Worker` has its own
 * thread and timers, so it still runs. It names the file and ends the process. The coordinator
 * then reports the file as crashed and runs the other files.
 *
 * `bunfig.toml` loads this file before each test file. Bun stops the `Worker` of a finished file.
 */
import { afterAll } from "bun:test";
import { relative } from "node:path";

/** The slowest file takes about 75 seconds on Linux, and git makes it a few times slower on Windows. */
const defaultLimitMs = 10 * 60_000;

/** Only a test lowers the limit. A value that is not a positive number keeps the default. */
function limitMs(): number {
  const value = Number(process.env["EVA_TEST_FILE_LIMIT_MS"]);
  return Number.isFinite(value) && value > 0 ? value : defaultLimitMs;
}

// Bun sets the variable only with `--parallel`. A plain `bun test` runs every file in one
// process, so a limit for each file does not fit it.
if (process.env["BUN_TEST_WORKER_ID"] !== undefined) {
  const limit = limitMs();
  const message = `${relative(process.cwd(), Bun.main)} ran for more than ${String(limit)} ms. Its thread may be blocked (#742).\n`;
  // A synchronous write: the kill comes next, and a buffered message would be lost.
  const source = `setTimeout(() => {
    require("node:fs").writeSync(2, ${JSON.stringify(message)});
    process.kill(process.pid, "SIGKILL");
  }, ${String(limit)});`;
  const watchdog = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
  afterAll(() => {
    watchdog.terminate();
  });
}
