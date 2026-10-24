import { describe, expect, test } from "bun:test";
import type { EngineEventPayload } from "../../../src/shared/events.ts";
import {
  addNote,
  addStep,
  historyLostNote,
  splitSteps,
  stepDetails,
  storedSteps,
  withoutDetails,
  type TurnStep,
} from "../../../src/shared/turn-steps.ts";

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

  test("a tool with no short field keeps its name before the input, so the step says which tool ran", () => {
    const steps = stepsOf([
      { kind: "tool_started", toolUseId: "t1", name: "mcp__demo__list", category: "tool", summary: '{"limit":5}' },
    ]);
    expect(steps[0]?.text).toBe('mcp__demo__list {"limit":5}');
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

describe("addStep limits", () => {
  test("a long tool summary is cut at once, so a running turn keeps no huge text", () => {
    const steps = stepsOf([
      { kind: "tool_started", toolUseId: "t1", name: "mcp", category: "tool", summary: "z".repeat(50_000) },
    ]);
    expect(steps[0]?.text.length).toBe(200);
  });

  test("a cut never splits an emoji", () => {
    const summary = `${"a".repeat(198)}😀😀😀`;
    const steps = stepsOf([{ kind: "tool_started", toolUseId: "t1", name: "Read", category: "tool", summary }]);
    expect(steps[0]?.text).toBe(`${"a".repeat(198)}😀…`);
  });

  test("an error marks only a step of the matching kind, and no match keeps the same list", () => {
    const steps = stepsOf([
      { kind: "tool_started", toolUseId: "same", name: "Read", category: "tool", summary: "Read a" },
      { kind: "task_changed", taskId: "same", description: "look", state: "running" },
    ]);
    const marked = addStep(steps, { kind: "tool_finished", toolUseId: "same", isError: true });
    expect(marked.map((step) => step.isError)).toEqual([true, false]);
    expect(addStep(steps, { kind: "tool_finished", toolUseId: "other", isError: true })).toBe(steps);
  });
});

describe("splitSteps", () => {
  test("the last message parts the steps into those before it and those after it", () => {
    const { before, lastMessage, after } = splitSteps(
      stepsOf([
        { kind: "text", text: "first", messageId: "m1" },
        { kind: "tool_started", toolUseId: "t1", name: "Bash", category: "command", summary: "ls" },
        { kind: "text", text: "second", messageId: "m2" },
        { kind: "tool_started", toolUseId: "t2", name: "Bash", category: "command", summary: "npm test" },
      ]),
    );
    expect(before.map((step) => step.text)).toEqual(["first", "ls"]);
    expect(lastMessage?.text).toBe("second");
    expect(after.map((step) => step.text)).toEqual(["npm test"]);
  });

  test("a turn with no message has all its steps before", () => {
    const { before, lastMessage, after } = splitSteps(
      stepsOf([{ kind: "tool_started", toolUseId: "t1", name: "Bash", category: "command", summary: "ls" }]),
    );
    expect([before.length, lastMessage, after.length]).toEqual([1, undefined, 0]);
  });
});

describe("storedSteps", () => {
  test("the last message stays, even when more than 100 steps follow it", () => {
    const payloads: EngineEventPayload[] = [
      { kind: "text", text: "the answer", messageId: "m1" },
      ...Array.from({ length: 120 }, (_, index): EngineEventPayload => ({
        kind: "tool_started",
        toolUseId: `t${String(index)}`,
        name: "Read",
        category: "tool",
        summary: `Read ${String(index)}`,
      })),
    ];
    const { steps, omittedSteps } = storedSteps(stepsOf(payloads));
    expect(steps[0]?.text).toBe("the answer");
    expect(steps).toHaveLength(101);
    expect(omittedSteps).toBe(20);
  });

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

describe("step details", () => {
  const payloads: readonly EngineEventPayload[] = [
    {
      kind: "tool_started",
      toolUseId: "t1",
      name: "Bash",
      category: "command",
      summary: "ls",
      input: '{"command":"ls"}',
    },
    { kind: "tool_finished", toolUseId: "t1", isError: false, output: "Notes.md\n" },
    { kind: "tool_started", toolUseId: "t2", name: "Read", category: "tool", summary: "Read x" },
    { kind: "text", text: "Done.", messageId: "m1" },
  ];

  test("a tool step keeps its whole input and output, uncut", () => {
    const long = "a".repeat(5000);
    const steps = stepsOf([
      { kind: "tool_started", toolUseId: "t1", name: "Read", category: "tool", summary: "Read x", input: long },
      { kind: "tool_finished", toolUseId: "t1", isError: true, output: long },
    ]);
    expect(steps).toEqual([{ kind: "tool", text: "Read x", isError: true, id: "t1", input: long, output: long }]);
  });

  test("storedSteps keeps the details, so a running answer shows them", () => {
    expect(storedSteps(stepsOf(payloads)).steps[0]).toMatchObject({ input: '{"command":"ls"}', output: "Notes.md\n" });
  });

  test("withoutDetails drops them, for the session record", () => {
    expect(stepsOf(payloads).map(withoutDetails)[0]).toEqual({ kind: "command", text: "ls", isError: false, id: "t1" });
  });

  test("stepDetails gives the details of each step that has some, by id", () => {
    expect(stepDetails(stepsOf(payloads))).toEqual([{ id: "t1", input: '{"command":"ls"}', output: "Notes.md\n" }]);
  });
});

describe("addNote", () => {
  test("a notice and a lost history each add one note, and the same note adds nothing (issue 157)", () => {
    const payloads: EngineEventPayload[] = [
      { kind: "notice", text: "Eva could not start the MCP server" },
      { kind: "text", text: "No calendar today.", messageId: "m1" },
      { kind: "history_lost" },
      { kind: "notice", text: "Eva could not start the MCP server" },
      { kind: "history_lost" },
    ];
    expect(payloads.reduce<readonly string[]>(addNote, [])).toEqual([
      "Eva could not start the MCP server",
      historyLostNote,
    ]);
  });

  test("an event that adds no note returns the same list", () => {
    const notes = ["one"];
    expect(addNote(notes, { kind: "text", text: "Hi.", messageId: "m1" })).toBe(notes);
    expect(addNote(notes, { kind: "notice", text: "one" })).toBe(notes);
  });
});
