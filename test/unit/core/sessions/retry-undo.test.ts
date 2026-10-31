import { describe, expect, test } from "bun:test";
import { answersToUndo, refsStillNamed } from "../../../../src/core/sessions/retry-undo.ts";
import { sessionSchema, type SessionRecord } from "../../../../src/core/sessions/session-store.ts";

function chat(id: string, ends: readonly string[], overrides: Partial<SessionRecord> = {}): SessionRecord {
  return sessionSchema.parse({
    id,
    engineSessionId: `engine-${id}`,
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
    createdAt: "2026-10-24T09:00:00.000Z",
    lastTurnAt: null,
    source: "web",
    telegramTopicId: null,
    turns: ends.map((at, index) => ({ userText: `message ${String(index)}`, lastMessageId: `m${String(index)}`, at })),
    ...overrides,
  });
}

/** The session and turn of each answer, from its `before` ref. */
function named(answers: ReturnType<typeof answersToUndo>): string[] {
  return answers.map((answer) => answer.before.replace("refs/eva/turns/", "").replace("/before", ""));
}

describe("answersToUndo", () => {
  test("a retry of answer 2 in a chat at answer 5 undoes answers 2 to 5, oldest first", () => {
    const root = chat("root", ["10:01", "10:02", "10:03", "10:04", "10:05"]);
    expect(named(answersToUndo([root], "root", 1))).toEqual(["root/1", "root/2", "root/3", "root/4"]);
  });

  test("a later answer in a fork of the chat counts too, an earlier one does not", () => {
    const root = chat("root", ["10:01", "10:02", "10:05"]);
    const fork = chat("fork", ["10:03", "10:06"], { parentId: "root", forkAtMessageId: "m0" });
    const deeper = chat("deeper", ["10:07"], { parentId: "fork", forkAtMessageId: "m0" });
    const other = chat("other", ["10:08"]);
    expect(named(answersToUndo([root, fork, deeper, other], "root", 2))).toEqual(["root/2", "fork/1", "deeper/0"]);
    expect(named(answersToUndo([root, fork, deeper, other], "fork", 0))).toEqual([
      "fork/0",
      "root/2",
      "fork/1",
      "deeper/0",
    ]);
  });

  test("a turn that a delete moved keeps the snapshots of the place where it ran (issue 647)", () => {
    const heir = chat("heir", ["10:01", "10:02", "10:03"]);
    const moved: SessionRecord = {
      ...heir,
      turns: heir.turns.map((turn, index) => ({
        ...turn,
        ranIn:
          index < 2
            ? { sessionId: "gone", turnIndex: index, engineSessionId: "engine-gone" }
            : { sessionId: "heir", turnIndex: 0, engineSessionId: null },
      })),
    };
    expect(named(answersToUndo([moved], "heir", 1))).toEqual(["gone/1", "heir/0"]);
  });

  test("a specialist chat works in the vault, so its retry undoes its answers too (#703)", () => {
    const coach = chat("coach", ["10:01", "10:02"], { mode: "project", startFolder: "/vault/Projects/coach" });
    const assistant = chat("assistant", ["10:03"]);
    expect(named(answersToUndo([coach, assistant], "coach", 0))).toEqual(["coach/0", "coach/1"]);
  });

  test("a chat in a clone, or a turn that does not exist, undoes nothing", () => {
    const project = chat("project", ["10:01"], { mode: "project", clone: "clone-0" });
    expect(answersToUndo([project], "project", 0)).toEqual([]);
    expect(answersToUndo([chat("root", ["10:01"])], "root", 4)).toEqual([]);
    expect(answersToUndo([], "missing", 0)).toEqual([]);
  });

  test("a missing parent ends the walk at the last known chat", () => {
    const orphan = chat("orphan", ["10:01", "10:02"], { parentId: "gone" });
    expect(named(answersToUndo([orphan], "orphan", 0))).toEqual(["orphan/0", "orphan/1"]);
  });

  test("on the same end time, the turn of the fork made later counts as later", () => {
    const root = chat("root", ["10:01", "10:05"]);
    const fork = chat("fork", ["10:05"], {
      parentId: "root",
      forkAtMessageId: "m0",
      createdAt: "2026-10-24T09:30:00.000Z",
    });
    expect(named(answersToUndo([fork, root], "root", 1))).toEqual(["root/1", "fork/0"]);
  });

  test("turns that ended at the same time keep their order, and an earlier turn of the chat stays", () => {
    const root = chat("root", ["10:01", "10:01"]);
    expect(named(answersToUndo([root], "root", 0))).toEqual(["root/0", "root/1"]);
    expect(named(answersToUndo([root], "root", 1))).toEqual(["root/1"]);
  });
});

describe("refsStillNamed", () => {
  test("lists the refs of a deleted chat that a moved turn still names (issue 647)", () => {
    const heir = chat("heir", ["10:01", "10:02"]);
    const moved: SessionRecord = {
      ...heir,
      turns: [{ ...heir.turns[0]!, ranIn: { sessionId: "gone", turnIndex: 3, engineSessionId: "engine-gone" } }],
    };
    expect([...refsStillNamed([moved, heir], "gone")]).toEqual([
      "refs/eva/turns/gone/3/before",
      "refs/eva/turns/gone/3/after",
    ]);
    expect(refsStillNamed([heir], "gone").size).toBe(0);
  });
});
