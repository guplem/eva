import { describe, expect, test } from "bun:test";
import { stopWithinDeadline } from "../../../../src/core/instance/shutdown.ts";

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
