import { describe, expect, test } from "bun:test";
import { formatTokens, latestContext, tasksOfTurn } from "../../../../../src/frontends/web/client/chat-details.ts";
import type { SessionRecord } from "../../../../../src/core/sessions/session-store.ts";

type Turn = SessionRecord["turns"][number];

function turn(at: string, contextTokens: number | null): Turn {
  return {
    userText: "hi",
    answerText: "ok",
    toolCount: 0,
    commandCount: 0,
    taskCount: 0,
    steps: [],
    omittedSteps: 0,
    contextTokens,
    failure: null,
    lastMessageId: null,
    at,
  };
}

function session(turns: Turn[]): Pick<SessionRecord, "turns"> {
  return { turns };
}

describe("formatTokens", () => {
  test("a small count stays exact, and a large one is rounded to thousands", () => {
    expect(formatTokens(850)).toBe("850 tokens");
    expect(formatTokens(25_365)).toBe("25.4k tokens");
    expect(formatTokens(3000)).toBe("3k tokens");
  });
});

describe("latestContext", () => {
  test("the newest answer of the chat or a fork gives the context", () => {
    const root = session([turn("2026-10-18T10:00:00.000Z", 100)]);
    const fork = session([turn("2026-10-18T11:00:00.000Z", 200)]);
    expect(latestContext([root, fork])).toBe(200);
  });

  test("a newest answer with no number gives null, not an older number", () => {
    const root = session([turn("2026-10-18T10:00:00.000Z", 100), turn("2026-10-18T11:00:00.000Z", null)]);
    expect(latestContext([root])).toBeNull();
  });

  test("a chat with no answer gives null", () => {
    expect(latestContext([session([])])).toBeNull();
  });
});

describe("tasksOfTurn", () => {
  test("a stored answer lists its own tasks: each one ended with its turn, and an error means it failed", () => {
    const steps: Turn["steps"] = [
      { kind: "message", text: "Looking.", isError: false, id: "m1" },
      { kind: "task", text: "look around", isError: false, id: "k1" },
      { kind: "task", text: "npm test", isError: true, id: "k2" },
    ];
    expect(tasksOfTurn(steps, "s1")).toEqual({
      k1: { description: "look around", state: "ended", sessionId: "s1" },
      k2: { description: "npm test", state: "failed", sessionId: "s1" },
    });
  });
});
