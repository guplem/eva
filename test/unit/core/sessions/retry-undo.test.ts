import { describe, expect, test } from "bun:test";
import { answersToUndo } from "../../../../src/core/sessions/retry-undo.ts";
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

  test("a Project chat, or a turn that does not exist, undoes nothing", () => {
    const project = chat("project", ["10:01"], { mode: "project" });
    expect(answersToUndo([project], "project", 0)).toEqual([]);
    expect(answersToUndo([chat("root", ["10:01"])], "root", 4)).toEqual([]);
    expect(answersToUndo([], "missing", 0)).toEqual([]);
  });

  test("a missing parent ends the walk at the last known chat", () => {
    const orphan = chat("orphan", ["10:01", "10:02"], { parentId: "gone" });
    expect(named(answersToUndo([orphan], "orphan", 0))).toEqual(["orphan/0", "orphan/1"]);
  });

  test("turns that ended at the same time keep their order", () => {
    const root = chat("root", ["10:01", "10:01"]);
    expect(named(answersToUndo([root], "root", 0))).toEqual(["root/0", "root/1"]);
  });
});
