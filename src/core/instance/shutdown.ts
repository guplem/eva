/**
 * A stop that always ends (docs/plan.md §6, lesson 81). Eva runs for weeks as a service: a
 * front end that never answers must not keep the process, and so the lock, alive.
 */

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
