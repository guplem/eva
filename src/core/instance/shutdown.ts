/**
 * A stop that always ends (lesson 81). Eva runs for weeks as a service: a
 * front end that never answers must not keep the process, and so the lock, alive.
 */

import { exitCodes } from "../../shared/exit-codes.ts";
import type { Logger } from "../../shared/logger.ts";

export type ShutdownOutcome =
  { readonly kind: "stopped" } | { readonly kind: "timed_out" } | { readonly kind: "failed"; readonly reason: string };

/** Runs the stop work, and gives up on it after the deadline. It never throws. */
export async function stopWithinDeadline(work: () => Promise<void>, deadlineMs: number): Promise<ShutdownOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ShutdownOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: "timed_out" });
    }, deadlineMs);
    // The timer alone must never keep the process alive.
    timer.unref();
  });
  const stopped = (async (): Promise<ShutdownOutcome> => {
    try {
      await work();
      return { kind: "stopped" };
    } catch (error) {
      return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
  })();
  try {
    return await Promise.race([stopped, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export interface StopSequenceOptions {
  /** Stops the timers, the core and the front ends. */
  readonly stopParts: () => Promise<void>;
  /** Clears the run marker and releases the lock. It runs even when the stop fails or hangs. */
  readonly release: () => void;
  readonly logger?: Logger;
  readonly deadlineMs: number;
  /** Ends the process later, as the last guard, in case even this sequence hangs. */
  readonly armHardExit: (exitCode: number) => void;
  /** After an update: starts a new copy when no supervisor restarts Eva. True when it did. */
  readonly startNewCopy: () => boolean;
}

/**
 * The stop of a running Eva, which runs once whatever asks for it (a signal, an update, a
 * restart). The returned promise gives the exit code of the process.
 */
export function stopSequence(options: StopSequenceOptions): (exitCode: number) => Promise<number> {
  let stopping: Promise<number> | null = null;
  return (exitCode) => {
    stopping ??= (async (): Promise<number> => {
      options.armHardExit(exitCode);
      try {
        const outcome = await stopWithinDeadline(options.stopParts, options.deadlineMs);
        if (outcome.kind !== "stopped") options.logger?.log("warn", "Eva did not stop cleanly.", { ...outcome });
      } finally {
        options.release();
        options.logger?.log("info", "Eva stopped.", { exitCode });
      }
      return exitCode === exitCodes.update && options.startNewCopy() ? exitCodes.clean : exitCode;
    })();
    return stopping;
  };
}

/** systemd sends SIGKILL 90 seconds after SIGTERM by default; Eva ends well before that. */
export const shutdownDeadlineMs = 20_000;
/** The last guard after the deadline: a stop that still hangs ends the process then. */
export const hardExitGraceMs = 5_000;
