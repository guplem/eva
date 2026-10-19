import { describe, expect, test } from "bun:test";
import type { SessionRecord } from "../../../../src/core/sessions/session-store.ts";
import { withRecentSteps, withRunState } from "../../../../src/frontends/api/session-list.ts";

type Turn = SessionRecord["turns"][number];

function turn(text: string): Turn {
  return {
    userText: "ask",
    answerText: text,
    toolCount: 0,
    commandCount: 0,
    taskCount: 0,
    steps: [{ kind: "message", text, isError: false, id: text }],
    omittedSteps: 2,
    contextTokens: null,
    contextWindow: null,
    failure: null,
    lastMessageId: text,
    at: "2026-10-14T12:00:00.000Z",
  };
}

function session(turns: Turn[]): SessionRecord {
  return {
    id: "s1",
    engineSessionId: "e1",
    engine: "claude-code",
    mode: "assistant",
    modelAlias: "default",
    startFolder: "/vault",
    projectId: null,
    clone: null,
    parentId: null,
    forkAtMessageId: null,
    forkFromEngineSessionId: null,
    title: "A chat",
    createdAt: "2026-10-14T12:00:00.000Z",
    lastTurnAt: null,
    source: "web",
    telegramTopicId: null,
    historyLost: false,
    turns,
  };
}

describe("withRecentSteps", () => {
  test("keeps the steps of the recent turns only, so a long chat costs a phone little on each fetch", () => {
    const stored = session(["one", "two", "three"].map(turn));
    const [listed] = withRecentSteps([stored], 2);
    expect(listed?.turns.map((kept) => [kept.answerText, kept.steps.length, kept.omittedSteps])).toEqual([
      ["one", 0, 0],
      ["two", 1, 2],
      ["three", 1, 2],
    ]);
    // The fork view finds a turn by its last message id.
    expect(listed?.turns[0]?.lastMessageId).toBe("one");
    // Telegram reads the stored record in the process, with every step.
    expect(stored.turns[0]?.steps).toHaveLength(1);
  });

  test("a chat with few turns stays the same", () => {
    const short = session([turn("one")]);
    expect(withRecentSteps([short], 2)).toEqual([short]);
  });
});

describe("withRunState", () => {
  test("marks each chat whose turn runs, so a page that reloads mid-turn still shows it", () => {
    const quiet = session([]);
    const working = { ...session([]), id: "s2" };
    const listed = withRunState([quiet, working], (id) => id === "s2");
    expect(listed.map((entry) => [entry.id, entry.running])).toEqual([
      ["s1", false],
      ["s2", true],
    ]);
  });
});
