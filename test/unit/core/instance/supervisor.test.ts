import { describe, expect, test } from "bun:test";
import { restartDecision } from "../../../../src/core/instance/supervisor.ts";

describe("restartDecision", () => {
  test("a clean stop, bad settings and a second instance stop the supervisor with the same code", () => {
    for (const exitCode of [0, 2, 3]) expect(restartDecision(exitCode, 0)).toEqual({ kind: "stop", exitCode });
  });

  test("an update restarts at once, and it never counts as a crash", () => {
    expect(restartDecision(4, 0)).toEqual({ kind: "restart", afterMs: 0, crash: false });
    expect(restartDecision(4, 7)).toEqual({ kind: "restart", afterMs: 0, crash: false });
  });

  test("a crash restarts after a delay that doubles, and never waits more than 30 seconds", () => {
    const delays = [0, 1, 2, 3, 4, 50].map((crashes) => restartDecision(1, crashes));
    expect(delays.map((decision) => (decision.kind === "restart" ? decision.afterMs : null))).toEqual([
      5_000, 10_000, 20_000, 30_000, 30_000, 30_000,
    ]);
    expect(delays.every((decision) => decision.kind === "restart" && decision.crash)).toBe(true);
  });

  test("an unknown exit code, such as a hard kill, counts as a crash", () => {
    expect(restartDecision(137, 0)).toEqual({ kind: "restart", afterMs: 5_000, crash: true });
    expect(restartDecision(-1, 0)).toEqual({ kind: "restart", afterMs: 5_000, crash: true });
  });
});
