import { describe, expect, test } from "bun:test";
import {
  branchMap,
  branchNames,
  branchStates,
  branchesAfter,
  branchesAtStart,
  firstShownBranch,
  pathOf,
  pickedBranch,
  seenPart,
  type BranchSession,
} from "../../../../../src/frontends/web/client/branch-path.ts";

type Turn = BranchSession["turns"][number];

function turn(userText: string, lastMessageId: string | null): Turn {
  return { userText, lastMessageId };
}

function session(
  id: string,
  turns: Turn[],
  fork: { parentId?: string; at?: string | null; createdAt?: string; lastTurnAt?: string | null } = {},
): BranchSession {
  return {
    id,
    parentId: fork.parentId ?? null,
    forkAtMessageId: fork.at ?? null,
    turns,
    createdAt: fork.createdAt ?? "2026-10-20T10:00:00.000Z",
    lastTurnAt: fork.lastTurnAt ?? null,
  };
}

// The chat asks three questions. Fork 1 continues after answer 2. Fork 2 retries answer 1.
const main = session("main", [turn("one", "m1"), turn("two", "m2"), turn("three", "m3")]);
const fork1 = session("fork1", [turn("two b", "f1"), turn("three b", "f2")], { parentId: "main", at: "m2" });
const fork2 = session("fork2", [turn("one again", "r1")], { parentId: "main", at: null });
const tree = [main, fork1, fork2];

function texts(shown: BranchSession): string[] {
  return pathOf(shown, tree).map((step) => `${step.session.id}:${step.turn.userText}`);
}

describe("pathOf", () => {
  test("the main line is its own turns", () => {
    expect(texts(main)).toEqual(["main:one", "main:two", "main:three"]);
  });

  test("a fork shows the turns of its parent up to its answer, then its own", () => {
    expect(texts(fork1)).toEqual(["main:one", "main:two", "fork1:two b", "fork1:three b"]);
  });

  test("a fork from the start shares no turn", () => {
    expect(texts(fork2)).toEqual(["fork2:one again"]);
  });

  test("a fork of a fork shares both lines", () => {
    const deep = session("deep", [turn("four", "d1")], { parentId: "fork1", at: "f1" });
    expect(pathOf(deep, [...tree, deep]).map((step) => step.turn.userText)).toEqual(["one", "two", "two b", "four"]);
  });

  test("each turn keeps its index in its own session, for Retry and Fork", () => {
    expect(pathOf(fork1, tree).map((step) => step.index)).toEqual([0, 1, 0, 1]);
  });

  test("a fork whose answer is gone shares the whole parent, and a lost parent shares nothing", () => {
    const lost = session("lost", [], { parentId: "main", at: "gone" });
    expect(pathOf(lost, [main, lost])).toHaveLength(3);
    expect(pathOf(lost, [lost])).toEqual([]);
  });

  test("a loop of parents in a damaged list ends", () => {
    const first = session("a", [turn("a", "a1")], { parentId: "b", at: "b1" });
    const second = session("b", [turn("b", "b1")], { parentId: "a", at: "a1" });
    expect(pathOf(first, [first, second]).length).toBeLessThan(10);
  });
});

describe("branchesAfter", () => {
  test("an answer with a fork offers its own line first, then the fork", () => {
    const path = pathOf(main, tree);
    const point = branchesAfter(path, 1, main, tree);
    expect(point?.branches.map((branch) => branch.id)).toEqual(["main", "fork1"]);
    expect(point?.shownId).toBe("main");
  });

  test("on the fork's path, the fork is the shown branch", () => {
    const point = branchesAfter(pathOf(fork1, tree), 1, fork1, tree);
    expect(point?.shownId).toBe("fork1");
  });

  test("an answer with no fork is no fork point", () => {
    expect(branchesAfter(pathOf(main, tree), 0, main, tree)).toBeNull();
    expect(branchesAfter(pathOf(main, tree), 2, main, tree)).toBeNull();
  });

  test("forks at the same answer come in the order they were made", () => {
    const later = session("later", [], { parentId: "main", at: "m2", createdAt: "2026-10-21T10:00:00.000Z" });
    const point = branchesAfter(pathOf(main, [...tree, later]), 1, main, [later, ...tree]);
    expect(point?.branches.map((branch) => branch.id)).toEqual(["main", "fork1", "later"]);
  });
});

describe("branchesAtStart", () => {
  test("a fork from the start makes the start a fork point", () => {
    const point = branchesAtStart(fork2, tree);
    expect(point?.branches.map((branch) => branch.id)).toEqual(["main", "fork2"]);
    expect(point?.shownId).toBe("fork2");
  });

  test("a chat with no fork from the start has no start point", () => {
    expect(branchesAtStart(main, [main, fork1])).toBeNull();
  });
});

describe("branchNames", () => {
  test("the chat is the main line, and each fork has a number", () => {
    expect(branchNames(tree)).toEqual(
      new Map([
        ["main", "Main line"],
        ["fork1", "Fork 1"],
        ["fork2", "Fork 2"],
      ]),
    );
  });

  test("a fork that the person named shows its name (issue 637)", () => {
    expect(branchNames([main, { ...fork1, forkName: "Short answer" }, fork2])).toEqual(
      new Map([
        ["main", "Main line"],
        ["fork1", "Short answer"],
        ["fork2", "Fork 2"],
      ]),
    );
  });

  test('the first branch shows its name too, and "Main line" without one (issue 647)', () => {
    expect(branchNames([{ ...main, forkName: "Plan A" }, fork1]).get("main")).toBe("Plan A");
  });
});

describe("firstShownBranch", () => {
  test("the branch with the newest activity shows first", () => {
    const busy = session("busy", [], { parentId: "main", at: "m1", createdAt: "2026-10-22T10:00:00.000Z" });
    const old = { ...main, lastTurnAt: "2026-10-21T10:00:00.000Z" };
    expect(firstShownBranch([old, busy]).id).toBe("busy");
    expect(firstShownBranch([{ ...old, lastTurnAt: "2026-10-23T10:00:00.000Z" }, busy]).id).toBe("main");
  });
});

describe("branchMap", () => {
  test("a row of a project work result names the result, not its raw message", () => {
    const report = {
      projectId: "example-app",
      projectTitle: "Example app",
      projectSessionId: "p1",
      request: "Fix it.",
      clone: "clone-0",
      repositories: [],
      failed: false,
      result: "Fixed it.",
      resultCut: false,
    };
    const result = { ...turn("[Project work finished: example-app]", "m9"), fromEva: true, projectReports: [report] };
    const chat = session("chat", [turn("one", "m1"), result]);
    expect(branchMap([chat], "chat").rows.map((row) => row.text)).toEqual([
      "one",
      "Eva finished the work in Example app",
    ]);
  });

  test("one row for each turn, the lanes in tree order, and the shown path in the accent", () => {
    const map = branchMap(tree, "fork1");
    expect(map.lanes).toBe(3);
    expect(map.rows.map((row) => `${String(row.lane)}:${row.text}`)).toEqual([
      "0:one",
      "0:two",
      "0:three",
      "1:two b",
      "1:three b",
      "2:one again",
    ]);
    expect(map.rows.map((row) => row.onPath)).toEqual([true, true, false, true, true, false]);
    expect(map.rows.at(4)?.current).toBe(true);
  });

  test("the fork leaves its answer with a bend, and its lane passes the rows between", () => {
    const map = branchMap(tree, "fork1");
    const two = map.rows[1];
    expect(two?.bends).toEqual([{ to: 1, hot: true }]);
    // Row "three" is the main line's, so lane 1 only passes it.
    expect(map.rows[2]?.lines).toContainEqual({ lane: 1, up: "hot", down: "hot" });
    expect(map.rows[2]?.lines).toContainEqual({ lane: 0, up: "plain", down: "none" });
    expect(map.rows[3]?.lines).toContainEqual({ lane: 1, up: "hot", down: "hot" });
    expect(map.rows[4]?.lines).toContainEqual({ lane: 1, up: "hot", down: "none" });
  });

  test("only the first row of each branch is its head, so its menu can delete it (issue 647)", () => {
    const map = branchMap(tree, "fork1");
    expect(map.rows.map((row) => row.branchHead)).toEqual([true, false, false, true, false, true]);
  });

  test("a fork from the start bends from the first row", () => {
    const map = branchMap(tree, "main");
    expect(map.rows[0]?.bends).toContainEqual({ to: 2, hot: false });
    expect(map.rows[0]?.lines).toContainEqual({ lane: 0, up: "none", down: "hot" });
  });

  test("a shown fork from the start shares no line with its parent", () => {
    const map = branchMap(tree, "fork2");
    expect(map.rows[0]?.bends).toContainEqual({ to: 2, hot: false });
    expect(map.rows[1]?.lines).toContainEqual({ lane: 2, up: "plain", down: "plain" });
    expect(map.rows.at(-1)?.lines).toContainEqual({ lane: 2, up: "plain", down: "none" });
  });

  test("a new fork with no turn gets one row, so a click can show it", () => {
    const fresh = session("fresh", [], { parentId: "main", at: "m3" });
    const map = branchMap([main, fresh], "fresh");
    expect(map.rows.at(-1)).toMatchObject({ sessionId: "fresh", index: null, onPath: true, current: true });
    expect(map.rows[2]?.bends).toEqual([{ to: 1, hot: true }]);
  });

  test("each row says its branch and its answer number on that branch", () => {
    const map = branchMap(tree, "main");
    expect(map.rows.map((row) => row.label)).toEqual([
      "Main line · answer 1",
      "Main line · answer 2",
      "Main line · answer 3",
      "Fork 1 · answer 3",
      "Fork 1 · answer 4",
      "Fork 2 · answer 1",
    ]);
  });
});

describe("seenPart", () => {
  test("each session of the shown line keeps only the turns that the page shows", () => {
    const seen = seenPart(tree, "fork1").map((part) => [part.id, part.turns.length]);
    expect(seen).toEqual([
      ["fork1", 2],
      ["main", 2],
    ]);
  });

  test("a fork from the start shows none of its parent", () => {
    expect(seenPart(tree, "fork2").map((part) => part.id)).toEqual(["fork2"]);
  });
});

describe("branchStates", () => {
  const seen = (shown: BranchSession, seenTurns: number): BranchSession & { seenTurns: number } => ({
    ...shown,
    seenTurns,
  });

  test("a request beats a running turn, and a running turn beats a new answer", () => {
    const states = branchStates(
      [seen(main, 0), seen(fork1, 0), seen(fork2, 0)],
      "none",
      new Set(["main"]),
      new Set(["main", "fork1"]),
    );
    expect(states).toEqual(
      new Map([
        ["main", "waiting"],
        ["fork1", "running"],
        ["fork2", "unread"],
      ]),
    );
  });

  test("Eva's own Project chat is never unread (#614)", () => {
    const states = branchStates([{ ...seen(main, 0), reportsTo: "asking" }], "none", new Set(), new Set());
    expect(states.size).toBe(0);
  });

  test("the shown branch is never unread, and a seen branch has no state", () => {
    const states = branchStates([seen(main, 0), seen(fork1, 2)], "main", new Set(), new Set());
    expect(states.size).toBe(0);
  });
});

describe("pickedBranch", () => {
  test("a row on the shown path keeps the branch, and another row shows its own", () => {
    expect(pickedBranch("fork1", { sessionId: "main", onPath: true })).toBe("fork1");
    expect(pickedBranch("fork1", { sessionId: "fork2", onPath: false })).toBe("fork2");
  });
});
