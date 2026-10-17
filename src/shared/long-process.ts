/**
 * The seam for a child process that runs for days, such as Eva under her supervisor. A
 * ProcessRunner run has a timeout and keeps the whole output, so it cannot hold such a child.
 * This seam has no run timeout: the caller bounds each wait instead, and every stop is bounded
 * (lesson 81).
 */
import { EvaError } from "./errors.ts";
import { stopProcessTree } from "./process-runner.ts";

export interface LongProcess {
  /** The exit code. A process that a signal ended gets 128 plus the signal number. */
  readonly exited: Promise<number>;
  /** Asks the process to stop, and stops it hard after the timeout. Waits at most twice the timeout. */
  stop(timeoutMs: number): Promise<void>;
}

export interface LongProcessOptions {
  readonly cwd: string;
  /** The whole environment of the child. */
  readonly environment: Readonly<Record<string, string>>;
}

export type LongProcessStarter = (command: readonly string[], options: LongProcessOptions) => LongProcess;

export const systemLongProcessStarter: LongProcessStarter = (command, options) => {
  let child: Bun.Subprocess<"ignore", "inherit", "inherit">;
  try {
    child = Bun.spawn([...command], {
      cwd: options.cwd,
      env: { ...options.environment },
      stdin: "ignore",
      // The child writes to the supervisor's own output; a pipe that nobody reads would block it.
      // No windowsHide: it can give the child a console of its own, which a Ctrl+C never reaches.
      stdout: "inherit",
      stderr: "inherit",
    });
  } catch (error) {
    throw new EvaError("process_failed", `Could not start ${command[0] ?? "a process"}.`, { cause: error });
  }
  const exited = child.exited;
  return {
    exited,
    stop: async (timeoutMs) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      // Windows has no gentle signal for another process. A Ctrl+C in the console already
      // reaches the child, so here the supervisor only waits, then stops the whole tree.
      if (process.platform !== "win32") child.kill("SIGTERM");
      const ended = await Promise.race([exited.then(() => true), Bun.sleep(timeoutMs).then(() => false)]);
      if (ended) return;
      if (process.platform === "win32") stopProcessTree(child.pid);
      else child.kill("SIGKILL");
      // A hard stop can fail too, so even this wait has a bound.
      await Promise.race([exited, Bun.sleep(timeoutMs)]);
    },
  };
};
