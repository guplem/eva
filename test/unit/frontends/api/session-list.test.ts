import { describe, expect, test } from "bun:test";
import type { SessionRecord } from "../../../../src/core/sessions/session-store.ts";
import { listedSessions, openedSession, previewTextLimit } from "../../../../src/frontends/api/session-list.ts";

type Turn = SessionRecord["turns"][number];

function turn(text: string): Turn {
  return {
    userText: "ask",
    fromEva: false,
    projectReports: [],
    personText: null,
    answerText: text,
    toolCount: 0,
    commandCount: 0,
    taskCount: 0,
    steps: [{ kind: "message", text, isError: false, id: text }],
    omittedSteps: 2,
    notes: [],
    contextTokens: null,
    contextWindow: null,
    model: null,
    failure: null,
    lastMessageId: text,
    at: "2026-10-14T12:00:00.000Z",
    startSnapshot: null,
    endSnapshot: null,
  };
}

function session(turns: Turn[]): SessionRecord {
  return {
    id: "s1",
    engineSessionId: "e1",
    engine: "claude-code",
    mode: "assistant",
    modelAlias: "opus",
    effort: "medium",
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
    seenTurns: 0,
    archived: false,
    closed: false,
    continuedFrom: null,
    firstMessageDraft: null,
    pendingRestore: null,
    forkedFrom: null,
    reportsTo: null,
    forkName: null,
    pinnedPage: null,
    turns,
  };
}

describe("listedSessions", () => {
  test("sends no turns, so a long history keeps the list small (#1046)", () => {
    const long = session(
      Array.from({ length: 200 }, (_, index) => ({ ...turn(`m${String(index)}`), answerText: "x".repeat(5000) })),
    );
    const [listed] = listedSessions([long], () => false);
    expect(listed).not.toHaveProperty("turns");
    expect(listed?.turnCount).toBe(200);
    expect(JSON.stringify(listed).length).toBeLessThan(4000);
  });

  test("keeps a short last turn for the preview, with no steps", () => {
    const stored = session([turn("one"), { ...turn("two"), answerText: `two ${"y".repeat(5000)}` }]);
    const [listed] = listedSessions([stored], () => false);
    expect(listed?.lastTurn?.answerText.startsWith("two y")).toBe(true);
    expect(listed?.lastTurn?.answerText.length).toBeLessThanOrEqual(previewTextLimit);
    expect(listed?.lastTurn?.steps).toEqual([]);
    expect(listed?.lastTurn?.lastMessageId).toBe(stored.turns[1]?.lastMessageId);
    expect(listedSessions([session([])], () => false)[0]?.lastTurn).toBeNull();
  });

  test("cuts the long texts of a project report of the last turn", () => {
    const report = {
      projectId: "p1",
      projectTitle: "Example app",
      projectSessionId: "s9",
      request: "r".repeat(5000),
      clone: null,
      repositories: [],
      failed: false,
      result: "z".repeat(5000),
      resultCut: false,
    };
    const [listed] = listedSessions([session([{ ...turn("one"), projectReports: [report] }])], () => false);
    const [kept] = listed?.lastTurn?.projectReports ?? [];
    expect(kept?.projectTitle).toBe("Example app");
    expect(kept?.request.length).toBeLessThanOrEqual(previewTextLimit);
    expect(kept?.result.length).toBeLessThanOrEqual(previewTextLimit);
  });

  test("marks each chat whose turn runs, so a page that reloads mid-turn still shows it", () => {
    const quiet = session([]);
    const working = { ...session([]), id: "s2" };
    const listed = listedSessions([quiet, working], (id) => id === "s2");
    expect(listed.map((entry) => [entry.id, entry.running])).toEqual([
      ["s1", false],
      ["s2", true],
    ]);
  });

  test("the turns key changes with any change of the turns, also a note on the last turn", () => {
    const stored = session([turn("one")]);
    const key = (record: SessionRecord): string | undefined => listedSessions([record], () => false)[0]?.turnsKey;
    expect(key(stored)).toBe(key(session([turn("one")])));
    const noted = { ...stored, turns: stored.turns.map((kept) => ({ ...kept, notes: ["A server did not start."] })) };
    expect(key(noted)).not.toBe(key(stored));
    expect(key({ ...stored, title: "Renamed" })).toBe(key(stored));
  });
});

describe("openedSession", () => {
  test("sends every turn, with the steps of the recent turns only", () => {
    const stored = session(["one", "two", "three"].map(turn));
    const opened = openedSession(stored, () => true, 2);
    expect(opened.turns.map((kept) => [kept.answerText, kept.steps.length, kept.omittedSteps])).toEqual([
      ["one", 0, 0],
      ["two", 1, 2],
      ["three", 1, 2],
    ]);
    expect(opened.running).toBe(true);
    expect(opened.turnCount).toBe(3);
    // The page compares it with the list's key, so both come from the stored turns.
    expect(opened.turnsKey).toBe(listedSessions([stored], () => true)[0]?.turnsKey ?? "");
    // Telegram reads the stored record in the process, with every step.
    expect(stored.turns[0]?.steps).toHaveLength(1);
  });

  test("a chat with few turns keeps each step", () => {
    const short = session([turn("one")]);
    expect(openedSession(short, () => false, 2).turns).toEqual(short.turns);
  });
});
