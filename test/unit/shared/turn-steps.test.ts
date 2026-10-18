import { describe, expect, test } from "bun:test";
import type { EngineEventPayload } from "../../../src/shared/events.ts";
import { addStep, storedSteps, type TurnStep } from "../../../src/shared/turn-steps.ts";

function stepsOf(payloads: readonly EngineEventPayload[]): readonly TurnStep[] {
  return payloads.reduce<readonly TurnStep[]>(addStep, []);
}

describe("addStep", () => {
  test("a message, a command, a tool and a task each add one step, in order", () => {
    expect(
      stepsOf([
        { kind: "text", text: "Let me look.", messageId: "m1" },
        { kind: "tool_started", toolUseId: "t1", name: "Bash", category: "command", summary: "ls" },
        { kind: "tool_started", toolUseId: "t2", name: "Grep", category: "tool", summary: "Grep notes" },
        { kind: "task_changed", taskId: "k1", description: "Search the notes", state: "running" },
      ]),
    ).toEqual([
      { kind: "message", text: "Let me look.", isError: false, id: "m1" },
      { kind: "command", text: "ls", isError: false, id: "t1" },
      { kind: "tool", text: "Grep notes", isError: false, id: "t2" },
      { kind: "task", text: "Search the notes", isError: false, id: "k1" },
    ]);
  });

  test("a failed tool marks its own step, and a tool that worked stays clean", () => {
    const steps = stepsOf([
      { kind: "tool_started", toolUseId: "t1", name: "Bash", category: "command", summary: "ls" },
      { kind: "tool_started", toolUseId: "t2", name: "Bash", category: "command", summary: "rm x" },
      { kind: "tool_finished", toolUseId: "t1", isError: false },
      { kind: "tool_finished", toolUseId: "t2", isError: true },
    ]);
    expect(steps.map((step) => step.isError)).toEqual([false, true]);
  });

  test("a task adds one step however often its state changes, and a failed task is marked", () => {
    const steps = stepsOf([
      { kind: "task_changed", taskId: "k1", description: "look", state: "running" },
      { kind: "task_changed", taskId: "k1", description: "It found nothing.", state: "failed" },
    ]);
    expect(steps).toEqual([{ kind: "task", text: "look", isError: true, id: "k1" }]);
  });

  test("other events add no step", () => {
    const steps = stepsOf([
      { kind: "notice", text: "hi" },
      { kind: "history_lost" },
      { kind: "approval_needed", requestId: "r", toolName: "Bash", summary: "x" },
      { kind: "tool_finished", toolUseId: "unknown", isError: true },
      { kind: "turn_failed", reason: "boom" },
    ]);
    expect(steps).toEqual([]);
  });
});

describe("storedSteps", () => {
  test("the last message keeps its full text, and every other step is cut", () => {
    const long = "x".repeat(500);
    const { steps, omittedSteps } = storedSteps(
      stepsOf([
        { kind: "text", text: long, messageId: "m1" },
        { kind: "tool_started", toolUseId: "t1", name: "Bash", category: "command", summary: long },
        { kind: "text", text: long, messageId: "m2" },
      ]),
    );
    expect(steps.map((step) => step.text.length)).toEqual([200, 200, 500]);
    expect(steps[0]?.text.endsWith("…")).toBe(true);
    expect(omittedSteps).toBe(0);
  });

  test("a turn keeps its last 100 steps and counts the rest", () => {
    const payloads: EngineEventPayload[] = Array.from({ length: 130 }, (_, index) => ({
      kind: "tool_started",
      toolUseId: `t${String(index)}`,
      name: "Read",
      category: "tool",
      summary: `Read ${String(index)}`,
    }));
    const { steps, omittedSteps } = storedSteps(stepsOf(payloads));
    expect(steps).toHaveLength(100);
    expect(steps[0]?.text).toBe("Read 30");
    expect(omittedSteps).toBe(30);
  });
});
