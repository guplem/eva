import { describe, expect, test } from "bun:test";
import type { ProgressStep } from "../../../../../src/core/setup/progress.ts";
import { restartQuestion, setupSummary, stepMark } from "../../../../../src/frontends/web/client/setup-summary.ts";

function step(state: ProgressStep["state"], lastOk: boolean | null = null): ProgressStep {
  return {
    key: "engine",
    title: "Engine",
    state,
    detail: "",
    check: null,
    lastCheck: lastOk === null ? null : { ok: lastOk, detail: "", at: "2026-01-01T00:00:00.000Z" },
  };
}

describe("a setup step's mark", () => {
  test("follows the step's state", () => {
    expect(stepMark(step("done"))).toBe("done");
    expect(stepMark(step("missing"))).toBe("missing");
    expect(stepMark(step("optional"))).toBe("optional");
    expect(stepMark(step("done", true))).toBe("done");
  });

  test("shows a failed last test, also on a step that is set up", () => {
    expect(stepMark(step("done", false))).toBe("failed");
    expect(stepMark(step("missing", false))).toBe("failed");
  });
});

describe("the setup ring", () => {
  test("counts the done steps over all steps, and the steps that need the person", () => {
    const summary = setupSummary([
      step("done"),
      step("done"),
      step("done"),
      step("done"),
      step("missing"),
      step("optional"),
    ]);
    expect(summary).toMatchObject({ done: 4, total: 6, left: 1, percent: 67, headline: "Setup: 1 step left" });
  });

  test("counts a failed step as one to do", () => {
    const summary = setupSummary([step("done", false), step("missing"), step("done")]);
    expect(summary).toMatchObject({ done: 1, total: 3, left: 2, headline: "Setup: 2 steps left" });
  });

  test("says when nothing is left, and shows no steps as an empty ring", () => {
    expect(setupSummary([step("done"), step("optional")]).headline).toBe("Setup is complete");
    expect(setupSummary([])).toMatchObject({ done: 0, total: 0, percent: 0 });
  });
});

describe("the restart question", () => {
  test("names each running chat", () => {
    expect(restartQuestion([])).toBe("Restart Eva now?");
    expect(restartQuestion(["Plan the trip"])).toBe('"Plan the trip" is running. A restart stops it. Restart Eva now?');
    expect(restartQuestion(["One", "Two"])).toBe(
      '2 chats are running: "One", "Two". A restart stops them. Restart Eva now?',
    );
  });
});
