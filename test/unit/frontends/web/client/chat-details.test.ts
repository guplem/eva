import { describe, expect, test } from "bun:test";
import {
  chatSubtitle,
  contextShare,
  contextFigure,
  engineLabel,
  branchForkPoint,
  formatTokenCount,
  latestContext,
  taskStatus,
  tasksOfTurn,
  titleCase,
} from "../../../../../src/frontends/web/client/chat-details.ts";
import type { SessionRecord } from "../../../../../src/core/sessions/session-store.ts";

type Turn = SessionRecord["turns"][number];

function turn(at: string, contextTokens: number | null, extra: Partial<Turn> = {}): Turn {
  return {
    userText: "hi",
    answerText: "ok",
    toolCount: 0,
    commandCount: 0,
    taskCount: 0,
    steps: [],
    omittedSteps: 0,
    notes: [],
    contextTokens,
    contextWindow: null,
    model: null,
    failure: null,
    lastMessageId: null,
    at,
    ...extra,
  };
}

function session(turns: Turn[], id = "s1"): Pick<SessionRecord, "id" | "turns"> {
  return { id, turns };
}

describe("formatTokenCount", () => {
  test("a small count stays exact, and a large one is rounded to thousands or millions", () => {
    expect(formatTokenCount(850)).toBe("850");
    expect(formatTokenCount(25_365)).toBe("25.4k");
    expect(formatTokenCount(3000)).toBe("3k");
    expect(formatTokenCount(200_000)).toBe("200k");
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(1_250_000)).toBe("1.3M");
  });
});

describe("latestContext", () => {
  test("the newest answer of the chat or a fork gives the context and its window", () => {
    const root = session([turn("2026-10-18T10:00:00.000Z", 100, { contextWindow: 1000 })]);
    const fork = session([turn("2026-10-18T11:00:00.000Z", 200, { contextWindow: 2000 })], "s2");
    expect(latestContext([root, fork])).toEqual({ tokens: 200, window: 2000 });
  });

  test("a newest answer with no number gives null, not an older number", () => {
    const root = session([turn("2026-10-18T10:00:00.000Z", 100), turn("2026-10-18T11:00:00.000Z", null)]);
    expect(latestContext([root])).toBeNull();
  });

  test("a chat with no answer gives null", () => {
    expect(latestContext([session([])])).toBeNull();
  });
});

describe("contextShare", () => {
  test("a known window gives a whole percent", () => {
    expect(contextShare({ tokens: 76_000, window: 200_000 })).toBe(38);
    expect(contextShare({ tokens: 15, window: 200_000 })).toBe(0);
  });

  test("an unknown window gives no share, so Eva guesses no limit", () => {
    expect(contextShare({ tokens: 76_000, window: null })).toBeNull();
  });

  test("a count above the window shows a full ring, not more", () => {
    expect(contextShare({ tokens: 300, window: 200 })).toBe(100);
  });
});

describe("contextFigure", () => {
  test("names the window when Eva knows it, and the count only when she does not", () => {
    expect(contextFigure({ tokens: 76_000, window: 200_000 })).toBe("76k of 200k");
    expect(contextFigure({ tokens: 25_365, window: null })).toBe("25.4k");
  });
});

describe("engineLabel and titleCase", () => {
  test("the panel names each engine as its maker does, and starts a model or a mode with a capital", () => {
    expect(engineLabel("claude-code")).toBe("Claude Code");
    expect(engineLabel("pi")).toBe("pi");
    expect(titleCase("sonnet")).toBe("Sonnet");
    expect(titleCase("assistant")).toBe("Assistant");
  });
});

describe("taskStatus", () => {
  test("each state has one word and one tone", () => {
    expect(taskStatus("running")).toEqual({ label: "Running", tone: "live" });
    expect(taskStatus("done")).toEqual({ label: "OK", tone: "ok" });
    expect(taskStatus("failed")).toEqual({ label: "Failed", tone: "bad" });
    expect(taskStatus("ended")).toEqual({ label: "Ended", tone: "idle" });
  });

  test("a state that this page does not know shows as it is", () => {
    expect(taskStatus("paused")).toEqual({ label: "paused", tone: "idle" });
  });
});

describe("branchForkPoint", () => {
  const root = {
    ...session([turn("2026-10-18T10:00:00.000Z", null, { lastMessageId: "m1" })]),
    parentId: null,
    forkAtMessageId: null,
    createdAt: "2026-10-18T09:00:00.000Z",
    lastTurnAt: null,
  };
  const fork = {
    ...session([], "s2"),
    parentId: "s1",
    forkAtMessageId: "m1",
    createdAt: "2026-10-18T11:00:00.000Z",
    lastTurnAt: null,
  };

  test("a branch forks at the newest answer on its path, even one that it shares", () => {
    expect(branchForkPoint([root, fork], "s2")).toEqual({ sessionId: "s1", messageId: "m1" });
  });

  test("an answer that failed or has no message id is no fork point", () => {
    const failed = turn("2026-10-18T12:00:00.000Z", null, { lastMessageId: "m2", failure: "stopped" });
    const bare = turn("2026-10-18T13:00:00.000Z", null);
    const chat = { ...root, turns: [...root.turns, failed, bare] };
    expect(branchForkPoint([chat], "s1")).toEqual({ sessionId: "s1", messageId: "m1" });
    expect(branchForkPoint([{ ...root, turns: [bare] }], "s1")).toBeNull();
  });

  test("an unknown branch forks the first chat", () => {
    expect(branchForkPoint([root, fork], "gone")).toEqual({ sessionId: "s1", messageId: "m1" });
    expect(branchForkPoint([], null)).toBeNull();
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

describe("chatSubtitle", () => {
  test("names the engine and the mode", () => {
    expect(chatSubtitle({ engine: "claude-code", mode: "assistant" }, false)).toBe("Claude Code · Assistant");
    expect(chatSubtitle({ engine: "pi", mode: "project" }, false)).toBe("pi · Project");
  });

  test("starts with Working while a turn runs", () => {
    expect(chatSubtitle({ engine: "claude-code", mode: "assistant" }, true)).toBe("Working · Claude Code · Assistant");
  });
});
