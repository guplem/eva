/**
 * A time limit for a request of the page. On a phone a request can hang with no failure, such as
 * when the network changes. A hung send then locks the composer until a reload.
 */

/**
 * Runs the work with a signal that aborts after `ms`. When the time runs out, it fails with
 * `message`, even when the work ignores the signal.
 */
export async function withinTime<Answer>(
  ms: number,
  message: string,
  work: (signal: AbortSignal) => Promise<Answer>,
): Promise<Answer> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(message));
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}
