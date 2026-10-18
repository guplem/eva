import { describe, expect, test } from "bun:test";
import { applyEvent, emptyLiveState, type LiveState } from "../../../../../src/frontends/web/client/live-state.ts";
import type { EngineEventPayload, SessionEvent } from "../../../../../src/shared/events.ts";

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

  test("the end of a turn drops its steps and keeps the tasks and the other sessions", () => {
    let state = run([{ kind: "task_changed", taskId: "k1", description: "look", state: "running" }]);
    state = applyEvent(state, event({ kind: "text", text: "other", messageId: "m2" }, "s2"));
    state = applyEvent(state, event({ kind: "turn_failed", reason: "boom" }));
    expect(state.steps["s1"]).toBeUndefined();
    expect(state.steps["s2"]).toHaveLength(1);
    expect(state.tasks["k1"]).toBeDefined();
  });

  test("the end of a turn with no live steps leaves the state as it was", () => {
    const state = run([{ kind: "text", text: "hi", messageId: "m1" }], "s2");
    expect(applyEvent(state, event({ kind: "turn_failed", reason: "boom" }))).toBe(state);
  });

  test("an event with no step leaves the state as it was", () => {
    const state = run([{ kind: "text", text: "hi", messageId: "m1" }]);
    expect(applyEvent(state, event({ kind: "session_renamed", title: "x" }))).toBe(state);
  });
});
