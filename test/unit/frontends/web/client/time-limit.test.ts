import { describe, expect, test } from "bun:test";
import { withinTime } from "../../../../../src/frontends/web/client/time-limit.ts";

describe("withinTime", () => {
  test("gives the answer of work that ends in time", async () => {
    expect(await withinTime(1_000, "too slow", () => Promise.resolve("answer"))).toBe("answer");
  });

  test("fails with the message, and aborts the work, when the time runs out", async () => {
    let signal: AbortSignal | undefined;
    const error: unknown = await withinTime(10, "Eva did not answer.", (given) => {
      signal = given;
      return new Promise<string>(() => undefined);
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Eva did not answer.");
    expect(signal?.aborted).toBe(true);
  });

  test("gives the message, not the abort, of work that stops at the abort", async () => {
    const error: unknown = await withinTime(
      10,
      "Eva did not answer.",
      (signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("The operation was aborted.")));
        }),
    ).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("Eva did not answer.");
  });

  test("a limit that fires late, as after the phone slept, gives the work one short extra wait", async () => {
    // The first reading is the start. Each later reading is long after it: the page was frozen.
    let readings = 0;
    const now = (): number => (readings++ === 0 ? 0 : 60_000);
    const answer = await withinTime(
      10,
      "Eva did not answer.",
      () => new Promise<string>((resolve) => setTimeout(() => resolve("sent"), 40)),
      { now, graceMs: 200 },
    );
    expect(answer).toBe("sent");
  });

  test("work that still hangs after the extra wait fails with the message", async () => {
    let readings = 0;
    const now = (): number => (readings++ === 0 ? 0 : 60_000);
    let signal: AbortSignal | undefined;
    const error: unknown = await withinTime(
      10,
      "Eva did not answer.",
      (given) => {
        signal = given;
        return new Promise<string>(() => undefined);
      },
      { now, graceMs: 20 },
    ).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("Eva did not answer.");
    expect(signal?.aborted).toBe(true);
  });

  test("passes on the failure of work that fails in time", async () => {
    const failure = new TypeError("offline");
    const error: unknown = await withinTime(1_000, "too slow", () => Promise.reject(failure)).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBe(failure);
  });
});
