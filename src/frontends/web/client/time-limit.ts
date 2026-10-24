/**
 * A time limit for a request of the page. On a phone a request can hang with no failure, such as
 * when the network changes. A hung send then locks the composer until a reload.
 */

/** A timer that fires this much after its time ran while the page was frozen, such as on a locked phone. */
const lateMs = 1_000;

/** The extra wait after a frozen page wakes: the network needs a moment to come back. */
const defaultGraceMs = 5_000;

export interface TimeLimitOptions {
  readonly now?: () => number;
  readonly graceMs?: number;
}

/**
 * Runs the work with a signal that aborts after `ms`. When the time runs out, it fails with
 * `message`, even when the work ignores the signal. A locked phone freezes the page but not the
 * clock: a send made just before the lock would fail at once on wake, and a resend would double
 * the message. So a limit that fires late waits one short extra time first.
 */
export async function withinTime<Answer>(
  ms: number,
  message: string,
  work: (signal: AbortSignal) => Promise<Answer>,
  options: TimeLimitOptions = {},
): Promise<Answer> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    const fail = (): void => {
      // Reject first: the abort makes the work fail too, and the person must read this message.
      reject(new Error(message));
      controller.abort();
    };
    timer = setTimeout(() => {
      if (now() - startedAt > ms + lateMs) timer = setTimeout(fail, options.graceMs ?? defaultGraceMs);
      else fail();
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}
