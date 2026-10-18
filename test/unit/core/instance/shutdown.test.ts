import { describe, expect, test } from "bun:test";
import { stopSequence, stopWithinDeadline } from "../../../../src/core/instance/shutdown.ts";

describe("stopWithinDeadline", () => {
  test("reports a stop that ends in time", async () => {
    const steps: string[] = [];
    const outcome = await stopWithinDeadline(() => {
      steps.push("stopped");
      return Promise.resolve();
    }, 1_000);
    expect(outcome).toEqual({ kind: "stopped" });
    expect(steps).toEqual(["stopped"]);
  });

  test("gives up on a stop that hangs, so the process can still exit", async () => {
    const outcome = await stopWithinDeadline(() => new Promise<void>(() => undefined), 10);
    expect(outcome).toEqual({ kind: "timed_out" });
  });

  test("reports a stop that fails, with its reason", async () => {
    const outcome = await stopWithinDeadline(() => Promise.reject(new Error("the bot did not answer")), 1_000);
    expect(outcome).toEqual({ kind: "failed", reason: "the bot did not answer" });
  });

  test("reports a stop that throws before its first await", async () => {
    const outcome = await stopWithinDeadline(() => {
      throw new Error("no api");
    }, 1_000);
    expect(outcome).toEqual({ kind: "failed", reason: "no api" });
  });
});

describe("stopSequence", () => {
  function harness(stopParts: () => Promise<void> = () => Promise.resolve()): {
    stop: (exitCode: number) => Promise<number>;
    steps: string[];
    logs: string[];
    newCopy: { allowed: boolean };
  } {
    const steps: string[] = [];
    const logs: string[] = [];
    const newCopy = { allowed: false };
    const stop = stopSequence({
      stopParts: async () => {
        steps.push("parts");
        await stopParts();
      },
      release: () => steps.push("release"),
      logger: {
        log: (level, message) => {
          logs.push(`${level}: ${message}`);
        },
      },
      deadlineMs: 50,
      armHardExit: (exitCode) => steps.push(`hard exit armed for ${String(exitCode)}`),
      startNewCopy: () => {
        steps.push("new copy?");
        return newCopy.allowed;
      },
    });
    return { stop, steps, logs, newCopy };
  }

  test("arms the hard exit, stops the parts, then releases the lock, once", async () => {
    const { stop, steps, logs } = harness();
    const first = stop(0);
    const second = stop(4);
    expect(await first).toBe(0);
    expect(await second).toBe(0);
    expect(steps).toEqual(["hard exit armed for 0", "parts", "release"]);
    expect(logs).toEqual(["info: Eva stopped."]);
  });

  test("a stop that hangs still releases the lock, with a warning", async () => {
    const { stop, steps, logs } = harness(() => new Promise<void>(() => undefined));
    expect(await stop(0)).toBe(0);
    expect(steps).toEqual(["hard exit armed for 0", "parts", "release"]);
    expect(logs).toEqual(["warn: Eva did not stop cleanly.", "info: Eva stopped."]);
  });

  test("a stop that fails still releases the lock", async () => {
    const { stop, steps } = harness(() => Promise.reject(new Error("the bot did not answer")));
    expect(await stop(1)).toBe(1);
    expect(steps.at(-1)).toBe("release");
  });

  test("after an update, a new copy means a clean exit; a supervisor gets exit code 4", async () => {
    const supervised = harness();
    expect(await supervised.stop(4)).toBe(4);
    expect(supervised.steps.at(-1)).toBe("new copy?");
    const alone = harness();
    alone.newCopy.allowed = true;
    expect(await alone.stop(4)).toBe(0);
  });

  test("only an update starts a new copy", async () => {
    const { stop, steps } = harness();
    expect(await stop(0)).toBe(0);
    expect(steps).not.toContain("new copy?");
  });
});
