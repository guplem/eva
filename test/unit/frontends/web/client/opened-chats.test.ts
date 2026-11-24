import { describe, expect, test } from "bun:test";
import type { SessionRecord } from "../../../../../src/core/sessions/session-store.ts";
import type { ListedSession } from "../../../../../src/frontends/api/session-list.ts";
import {
  chatsToRead,
  emptyChats,
  openedTree,
  type KeptTurns,
} from "../../../../../src/frontends/web/client/opened-chats.ts";

type Turn = SessionRecord["turns"][number];

function turn(answerText: string): Turn {
  return {
    userText: "ask",
    fromEva: false,
    projectReports: [],
    personText: null,
    answerText,
    toolCount: 0,
    commandCount: 0,
    taskCount: 0,
    steps: [],
    omittedSteps: 0,
    notes: [],
    contextTokens: null,
    contextWindow: null,
    model: null,
    failure: null,
    lastMessageId: answerText,
    at: "2026-11-24T12:00:00.000Z",
    startSnapshot: null,
    endSnapshot: null,
  };
}

function listed(id: string, turnsKey: string, title = "A chat"): ListedSession {
  return {
    id,
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
    title,
    createdAt: "2026-11-24T12:00:00.000Z",
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
    running: false,
    turnCount: 1,
    lastTurn: null,
    turnsKey,
  };
}

describe("openedTree", () => {
  test("joins the fresh facts of the list with the kept turns", () => {
    const kept = new Map<string, KeptTurns>([["s1", { key: "k1", readFor: "k1", turns: [turn("one")] }]]);
    const [opened] = openedTree([listed("s1", "k1", "Renamed")], kept) ?? [];
    expect(opened?.title).toBe("Renamed");
    expect(opened?.turns.map((kept) => kept.answerText)).toEqual(["one"]);
  });

  test("is null until each chat of the tree has its turns, so the page shows no half tree", () => {
    const kept = new Map<string, KeptTurns>([["s1", { key: "k1", readFor: "k1", turns: [] }]]);
    expect(openedTree([listed("s1", "k1"), listed("s2", "k2")], kept)).toBeNull();
  });

  test("a chat or fork with no turn needs no read, so a new fork shows at once", () => {
    const fresh = { ...listed("s1", "k0"), turnCount: 0 };
    expect(openedTree([fresh], new Map())?.[0]?.turns).toEqual([]);
    expect(chatsToRead([fresh], new Map())).toEqual([]);
  });

  test("keeps old turns while newer ones load, so the answer does not blink", () => {
    const kept = new Map<string, KeptTurns>([["s1", { key: "old", readFor: "old", turns: [turn("one")] }]]);
    expect(openedTree([listed("s1", "new")], kept)?.[0]?.turns).toHaveLength(1);
  });
});

describe("chatsToRead", () => {
  test("reads a chat with no kept turns, or with turns that changed since", () => {
    const kept = new Map<string, KeptTurns>([
      ["same", { key: "k1", readFor: "k1", turns: [] }],
      ["changed", { key: "old", readFor: "old", turns: [] }],
    ]);
    const tree = [listed("same", "k1"), listed("changed", "new"), listed("unknown", "k3")];
    expect(chatsToRead(tree, kept)).toEqual([
      { id: "changed", listKey: "new" },
      { id: "unknown", listKey: "k3" },
    ]);
  });

  test("reads a chat once for each list key, also when the read brought a newer key", () => {
    // The core changed the chat after the list: the next list brings the newer key.
    const kept = new Map<string, KeptTurns>([["s1", { key: "newer", readFor: "listed", turns: [] }]]);
    expect(chatsToRead([listed("s1", "listed")], kept)).toEqual([]);
    expect(chatsToRead([listed("s1", "newest")], kept)).toEqual([{ id: "s1", listKey: "newest" }]);
  });
});

describe("emptyChats", () => {
  test("names each chat with no turn and nothing kept, so its first answer shows no skeleton", () => {
    const fresh = { ...listed("fresh", "k0"), turnCount: 0 };
    const keptFresh = { ...listed("kept", "k0"), turnCount: 0 };
    const kept = new Map<string, KeptTurns>([["kept", { key: "k0", readFor: "k0", turns: [] }]]);
    expect(emptyChats([fresh, keptFresh, listed("full", "k1")], kept).map((chat) => chat.id)).toEqual(["fresh"]);
    // After its first answer, the empty entry stands in while the page reads the chat.
    expect(openedTree([listed("kept", "k1")], kept)?.[0]?.turns).toEqual([]);
  });
});
