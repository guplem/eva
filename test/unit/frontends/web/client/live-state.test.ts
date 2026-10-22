import { describe, expect, test } from "bun:test";
import {
  applyEvent,
  emptyLiveState,
  forgetTaskEvents,
  stepsWithDraft,
  startRecovery,
  withRunningTurns,
  withTasks,
  type LiveState,
} from "../../../../../src/frontends/web/client/live-state.ts";
import type { EngineEventPayload, SessionEvent } from "../../../../../src/shared/events.ts";

const finished = {
  engineSessionId: "e1",
  lastMessageId: null,
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: null,
  contextTokens: null,
  contextWindow: null,
} as const;

let seq = 0;
function event(payload: EngineEventPayload, sessionId = "s1"): SessionEvent {
  seq += 1;
  return { ...payload, sessionId, seq, at: "2026-10-18T10:00:00.000Z" };
}

function run(payloads: readonly EngineEventPayload[], sessionId = "s1"): LiveState {
  return payloads.reduce((state, payload) => applyEvent(state, event(payload, sessionId)), emptyLiveState);
}

describe("applyEvent", () => {
  test("the core's own events change nothing of a running turn", () => {
    const stamp = { sessionId: "s1", seq: 1, at: "2026-10-18T10:00:00.000Z" };
    const core: SessionEvent[] = [
      { ...stamp, kind: "message_received", text: "Hi", origin: "api" },
      { ...stamp, kind: "project_work_started", projectId: "p", projectSessionId: "q", request: "r" },
      { ...stamp, kind: "session_deleted" },
    ];
    expect(core.reduce(applyEvent, emptyLiveState)).toBe(emptyLiveState);
  });

  test("a running turn collects its steps, before any message too", () => {
    const state = run([
      { kind: "tool_started", toolUseId: "t1", name: "Bash", category: "command", summary: "ls" },
      { kind: "text", text: "Done.", messageId: "m1" },
    ]);
    expect(state.steps["s1"]?.map((step) => step.kind)).toEqual(["command", "message"]);
  });

  test("the pieces of a block build its draft, which the block's final text replaces (issue 117)", () => {
    const drafting = run([
      { kind: "text_delta", text: "Here " },
      { kind: "text_delta", text: "is " },
    ]);
    expect(drafting.drafts["s1"]).toBe("Here is ");
    // A turn whose first event is a piece runs too.
    expect(drafting.steps["s1"]).toEqual([]);
    const done = applyEvent(drafting, event({ kind: "text", text: "Here is the answer.", messageId: "m1" }));
    expect(done.drafts).toEqual({});
    expect(done.steps["s1"]?.map((step) => step.text)).toEqual(["Here is the answer."]);
  });

  test("a block that starts again replaces the draft, and a draft of blanks shows nothing", () => {
    const state = run([
      { kind: "text_delta", text: "Hello ", startsBlock: true },
      { kind: "text_delta", text: "Hello world ", startsBlock: true },
    ]);
    expect(state.drafts["s1"]).toBe("Hello world ");
    expect(stepsWithDraft([], "\n ")).toEqual([]);
  });

  test("the end of a turn drops its draft, and an event of another chat keeps it", () => {
    const drafting = run([{ kind: "text_delta", text: "Half " }]);
    expect(applyEvent(drafting, event({ kind: "text", text: "Other.", messageId: "m9" }, "s2")).drafts).toEqual({
      s1: "Half ",
    });
    expect(applyEvent(drafting, event({ kind: "turn_failed", reason: "stopped" })).drafts).toEqual({});
    expect(applyEvent(drafting, event({ kind: "turn_finished", ...finished })).drafts).toEqual({});
  });

  test("a lost history is a message step, so the person sees the note", () => {
    const state = run([{ kind: "history_lost" }]);
    expect(state.steps["s1"]?.[0]?.kind).toBe("message");
    expect(state.steps["s1"]?.[0]?.text).toContain("lost");
  });

  test("a notice is a note of its chat, never a step, so the answer stays the last message", () => {
    const notice = 'Eva could not start the MCP server "google": no uvx';
    const state = run([
      { kind: "text", text: "No calendar today.", messageId: "m1" },
      { kind: "notice", text: notice },
    ]);
    expect(state.steps["s1"]?.map((step) => step.text)).toEqual(["No calendar today."]);
    expect(state.notes["s1"]).toEqual([notice]);
  });

  test("a turn whose first event is a notice runs, so the page shows Stop while it waits (issue 356)", () => {
    const state = run([{ kind: "notice", text: "Another chat runs a turn in this clone." }]);
    expect(state.steps["s1"]).toEqual([]);
    expect(
      run([
        { kind: "text", text: "Hi.", messageId: "m1" },
        { kind: "notice", text: "x" },
      ]).steps["s1"],
    ).toHaveLength(1);
  });

  test("the same notice of a follow-up turn shows once", () => {
    const state = run([
      { kind: "notice", text: "one" },
      { kind: "notice", text: "one" },
    ]);
    expect(state.notes["s1"]).toEqual(["one"]);
  });

  test("a notice outlives its turn, until the chat's next turn starts or the chat goes", () => {
    const stamp = { sessionId: "s1", seq: 1, at: "2026-10-18T10:00:00.000Z" };
    const ended = run([
      { kind: "notice", text: "one" },
      {
        kind: "turn_finished",
        engineSessionId: "e1",
        lastMessageId: null,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: null,
        contextTokens: null,
        contextWindow: null,
      },
    ]);
    expect(ended.notes["s1"]).toEqual(["one"]);
    const next = applyEvent(ended, { ...stamp, kind: "message_received", text: "Again", origin: "api" });
    expect(next.notes["s1"]).toBeUndefined();
    expect(applyEvent(ended, { ...stamp, kind: "session_deleted" }).notes["s1"]).toBeUndefined();
  });

  test("a usage limit outlives its turn and the next one, until a newer limit or a delete (issue #67)", () => {
    const limit = {
      kind: "usage_limit",
      status: "rejected",
      window: "five_hour",
      usedPercent: 100,
      resetsAt: "2026-10-18T12:00:00.000Z",
    } as const;
    let state = run([limit, { kind: "turn_failed", reason: "limit" }]);
    expect(state.usageLimits["s1"]).toMatchObject({ status: "rejected", window: "five_hour" });
    expect(state.steps["s1"]).toBeUndefined();
    const stamp = { sessionId: "s1", seq: 99, at: "2026-10-18T10:00:00.000Z" };
    state = applyEvent(state, { ...stamp, kind: "message_received", text: "again", origin: "api" });
    expect(state.usageLimits["s1"]?.status).toBe("rejected");
    state = applyEvent(state, event({ ...limit, status: "warning", usedPercent: 90 }));
    expect(state.usageLimits["s1"]?.status).toBe("warning");
    state = applyEvent(state, { ...stamp, kind: "session_deleted" });
    expect(state.usageLimits["s1"]).toBeUndefined();
  });
  test("a task is kept by id with its newest state, and is a step of its turn", () => {
    const state = run([
      { kind: "task_changed", taskId: "k1", description: "look", state: "running" },
      { kind: "task_changed", taskId: "k1", description: "found it", state: "done" },
    ]);
    expect(state.tasks).toEqual({ k1: { description: "found it", state: "done", sessionId: "s1" } });
    expect(state.steps["s1"]).toHaveLength(1);
  });

  test("the end of a turn drops its steps and its tasks, which end with it, and keeps the other sessions", () => {
    let state = run([{ kind: "task_changed", taskId: "k1", description: "look", state: "running" }]);
    state = applyEvent(
      state,
      event({ kind: "task_changed", taskId: "k2", description: "other", state: "running" }, "s2"),
    );
    state = applyEvent(state, event({ kind: "turn_failed", reason: "boom" }));
    expect(state.steps["s1"]).toBeUndefined();
    expect(state.steps["s2"]).toHaveLength(1);
    expect(Object.keys(state.tasks)).toEqual(["k2"]);
  });

  test("a turn that ends after a reload drops the tasks that the core sent", () => {
    let state = withTasks(emptyLiveState, {
      seq: 0,
      tasks: [{ taskId: "k1", sessionId: "s1", description: "look", state: "running" }],
    });
    expect(state.tasks).toEqual({ k1: { description: "look", state: "running", sessionId: "s1" } });
    state = applyEvent(state, event({ kind: "turn_finished", ...finished }));
    expect(state.tasks).toEqual({});
  });

  test("the tasks from the core replace the ones this page knew", () => {
    const state = run([{ kind: "task_changed", taskId: "k1", description: "look", state: "running" }]);
    expect(withTasks(state, { seq: seq + 1, tasks: [] }).tasks).toEqual({});
  });

  test("a snapshot older than a chat's last task event keeps that chat as it is, so an ended task never comes back (lesson 83)", () => {
    const running = { taskId: "k1", sessionId: "s1", description: "look", state: "running" as const };
    const read = seq;
    const state = run([
      { kind: "task_changed", ...running },
      { kind: "turn_finished", ...finished },
    ]);
    expect(withTasks(state, { seq: read + 1, tasks: [running] }).tasks).toEqual({});
  });

  test("a newer event of another chat does not hide the tasks that the page missed", () => {
    const read = seq;
    const state = run([{ kind: "task_changed", taskId: "k2", description: "other", state: "running" }], "s2");
    const missed = { taskId: "k1", sessionId: "s1", description: "look", state: "running" as const };
    expect(withTasks(state, { seq: read, tasks: [missed] }).tasks).toEqual({
      k1: { description: "look", state: "running", sessionId: "s1" },
      k2: { description: "other", state: "running", sessionId: "s2" },
    });
  });

  test("after a reconnect, a snapshot from a restarted Eva counts, though its seq starts again", () => {
    const state = run([{ kind: "task_changed", taskId: "k1", description: "look", state: "running" }]);
    expect(withTasks(forgetTaskEvents(state), { seq: 0, tasks: [] }).tasks).toEqual({});
  });

  test("the end of a turn with no live steps keeps the steps and tasks of the other sessions", () => {
    const state = run(
      [
        { kind: "text", text: "hi", messageId: "m1" },
        { kind: "task_changed", taskId: "k1", description: "look", state: "running" },
      ],
      "s2",
    );
    const after = applyEvent(state, event({ kind: "turn_failed", reason: "boom" }));
    expect(after.steps).toEqual(state.steps);
    expect(after.tasks).toEqual(state.tasks);
  });

  test("an event with no step leaves the state as it was", () => {
    const state = run([{ kind: "text", text: "hi", messageId: "m1" }]);
    expect(applyEvent(state, event({ kind: "session_renamed", title: "x" }))).toBe(state);
    expect(applyEvent(state, event({ kind: "session_seen", seenTurns: 1 }))).toBe(state);
    expect(applyEvent(state, event({ kind: "session_archived", archived: true }))).toBe(state);
  });
});

describe("stepsWithDraft", () => {
  test("adds the draft as the last message, and keeps the steps as they are with no draft", () => {
    const steps = run([{ kind: "tool_started", toolUseId: "t1", name: "Read", category: "tool", summary: "a" }]).steps[
      "s1"
    ]!;
    expect(stepsWithDraft(steps, undefined)).toBe(steps);
    expect(stepsWithDraft(steps, "")).toBe(steps);
    expect(stepsWithDraft(steps, "Here is ").map((step) => [step.kind, step.text])).toEqual([
      ["tool", "a"],
      ["message", "Here is "],
    ]);
  });
});

describe("withRunningTurns", () => {
  const firstBlock = { kind: "message" as const, text: "First block.", isError: false, id: "m1" };

  test("a page that missed the events shows the steps that the core kept", () => {
    const state = startRecovery(emptyLiveState, 1);
    const after = withRunningTurns(state, 1, { seq, turns: [{ sessionId: "s1", steps: [firstBlock] }] });
    expect(after.steps).toEqual({ s1: [firstBlock] });
  });

  test("the page keeps its steps while it waits, so the answer does not blink", () => {
    const state = run([{ kind: "text", text: "First block.", messageId: "m1" }]);
    expect(startRecovery(state, 1).steps).toEqual(state.steps);
  });

  test("the snapshot replaces the steps of a turn that ended while the page slept", () => {
    const state = startRecovery(run([{ kind: "text", text: "Old.", messageId: "m0" }]), 1);
    expect(withRunningTurns(state, 1, { seq, turns: [] }).steps).toEqual({});
  });

  test("an event newer than the snapshot, which came first, is applied again on top of it (lesson 83)", () => {
    const read = seq;
    let state = startRecovery(emptyLiveState, 1);
    state = applyEvent(state, event({ kind: "text", text: "Second block.", messageId: "m2" }));
    const after = withRunningTurns(state, 1, { seq: read, turns: [{ sessionId: "s1", steps: [firstBlock] }] });
    expect(after.steps["s1"]?.map((step) => step.text)).toEqual(["First block.", "Second block."]);
  });

  test("an event that the snapshot holds already is not applied twice", () => {
    let state = startRecovery(emptyLiveState, 1);
    state = applyEvent(state, event({ kind: "text", text: "First block.", messageId: "m1" }));
    const after = withRunningTurns(state, 1, { seq, turns: [{ sessionId: "s1", steps: [firstBlock] }] });
    expect(after.steps).toEqual({ s1: [firstBlock] });
  });

  test("a turn end newer than the snapshot keeps the turn ended", () => {
    const read = seq;
    let state = startRecovery(emptyLiveState, 1);
    state = applyEvent(state, event({ kind: "turn_finished", ...finished }));
    const after = withRunningTurns(state, 1, { seq: read, turns: [{ sessionId: "s1", steps: [firstBlock] }] });
    expect(after.steps).toEqual({});
  });

  test("a failed read clears the old steps and keeps the newer events, as before", () => {
    let state = startRecovery(run([{ kind: "text", text: "Old.", messageId: "m0" }]), 1);
    state = applyEvent(state, event({ kind: "text", text: "New.", messageId: "m1" }));
    expect(withRunningTurns(state, 1, null).steps["s1"]?.map((step) => step.text)).toEqual(["New."]);
  });

  test("a newer recovery wins: an older failed read does not wipe the answer that it restored", () => {
    let state = startRecovery(startRecovery(emptyLiveState, 1), 2);
    state = withRunningTurns(state, 2, { seq, turns: [{ sessionId: "s1", steps: [firstBlock] }] });
    expect(withRunningTurns(state, 1, null)).toBe(state);
  });

  test("a newer recovery wins: an older snapshot that comes last changes nothing", () => {
    let state = startRecovery(startRecovery(emptyLiveState, 1), 2);
    state = withRunningTurns(state, 2, { seq, turns: [] });
    expect(withRunningTurns(state, 1, { seq, turns: [{ sessionId: "s1", steps: [firstBlock] }] })).toBe(state);
  });

  test("a newer recovery keeps only its own events, so the events of a restarted Eva's old process go", () => {
    let state = startRecovery(emptyLiveState, 1);
    state = applyEvent(state, { ...event({ kind: "text", text: "Ghost.", messageId: "m9" }), seq: 500 });
    state = startRecovery(state, 2);
    expect(withRunningTurns(state, 2, { seq: 3, turns: [] }).steps).toEqual({});
  });

  test("the page stops keeping events when the newest recovery ends", () => {
    const state = withRunningTurns(startRecovery(emptyLiveState, 1), 1, null);
    expect(state.recovery).toBeNull();
  });

  test("with no recovery, events are not kept", () => {
    const state = run([{ kind: "text", text: "hi", messageId: "m1" }]);
    expect(state.recovery).toBeNull();
  });
});

describe("withRunningTurns and drafts", () => {
  test("a page that comes back shows the draft that the core kept, with the newer pieces on top", () => {
    const read = seq;
    let state = startRecovery(run([{ kind: "text_delta", text: "Stale ", startsBlock: true }]), 1);
    state = applyEvent(state, event({ kind: "text_delta", text: "so far " }));
    const after = withRunningTurns(state, 1, { seq: read, turns: [{ sessionId: "s1", steps: [], draft: "Here is " }] });
    expect(after.drafts).toEqual({ s1: "Here is so far " });
  });

  test("an older Eva sends no draft, so the page keeps only the newer pieces", () => {
    let state = startRecovery(run([{ kind: "text_delta", text: "Stale " }]), 1);
    state = applyEvent(state, event({ kind: "text_delta", text: "new " }));
    expect(withRunningTurns(state, 1, null).drafts).toEqual({ s1: "new " });
    expect(
      withRunningTurns(startRecovery(emptyLiveState, 2), 2, { seq, turns: [{ sessionId: "s1", steps: [] }] }).drafts,
    ).toEqual({});
  });
});
