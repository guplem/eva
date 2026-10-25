import { describe, expect, test } from "bun:test";
import {
  chatSubtitle,
  contextShare,
  contextFigure,
  engineLabel,
  branchForkPoint,
  chatLinks,
  formatTokenCount,
  latestContext,
  modelNames,
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
    startSnapshot: null,
    endSnapshot: null,
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

describe("modelNames (#545)", () => {
  test("names each model of the chat and its forks once, with the model that answered it", () => {
    const answered = turn("2026-10-18T10:00:00.000Z", null, { model: "claude-opus-5-5", modelAlias: "opus" });
    const root = { modelAlias: "opus" as const, turns: [answered] };
    // A fork with no answer yet runs on the same model, so it adds no second name.
    const fork = { modelAlias: "opus" as const, turns: [] };
    const switched = { modelAlias: "haiku" as const, turns: [answered] };
    expect(modelNames([root, fork])).toBe("Smart · Opus 5.5");
    expect(modelNames([root, switched])).toBe("Smart · Opus 5.5, Fast");
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
  test("each state has one word, one tone and one icon", () => {
    expect(taskStatus("running")).toEqual({ label: "Running", tone: "live", icon: "sync" });
    expect(taskStatus("done")).toEqual({ label: "OK", tone: "ok", icon: "check" });
    expect(taskStatus("failed")).toEqual({ label: "Failed", tone: "bad", icon: "alert" });
    expect(taskStatus("ended")).toEqual({ label: "Ended", tone: "idle", icon: "check" });
  });

  test("only a running task shows the sync icon, so a task that ended does not look busy", () => {
    const busy = ["running", "done", "failed", "ended", "paused"].filter((state) => taskStatus(state).icon === "sync");
    expect(busy).toEqual(["running"]);
  });

  test("a state that this page does not know shows as it is", () => {
    expect(taskStatus("paused")).toEqual({ label: "paused", tone: "idle", icon: "info" });
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

  test("project work lists its Project chat: it started, and it may still run in that chat", () => {
    const steps: Turn["steps"] = [
      { kind: "task", text: "example-app: Fix it", isError: false, id: "p1", chatId: "p1" },
    ];
    expect(tasksOfTurn(steps, "s1")).toEqual({
      p1: { description: "example-app: Fix it", state: "started", sessionId: "s1", chatId: "p1" },
    });
    expect(taskStatus("started")).toEqual({ label: "Started", tone: "idle", icon: "chat" });
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

describe("chatLinks (#522)", () => {
  const chat = (id: string, continuedFrom: string | null = null): Pick<SessionRecord, "id" | "continuedFrom"> => ({
    id,
    continuedFrom,
  });

  test("a chat links to the chat that it continues, and to each chat that continues one of its branches", () => {
    const old = chat("old");
    const fork = chat("fork");
    const next = chat("next", "fork");
    const later = chat("later", "old");
    const sessions = [old, fork, next, later, chat("other")];
    expect(chatLinks([old, fork], sessions)).toEqual({ from: null, next: [next, later] });
    expect(chatLinks([next], sessions)).toEqual({ from: fork, next: [] });
  });

  test("a chat whose old chat is gone links to nothing", () => {
    expect(chatLinks([chat("next", "deleted")], [])).toEqual({ from: null, next: [] });
  });
});
