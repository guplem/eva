import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, type SessionRecord } from "../../../../src/core/sessions/session-store.ts";

let folder: string;
let path: string;
let logged: string[];
const clock = new Date("2026-10-14T10:30:00.000Z");

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-session-store-"));
  path = join(folder, "sessions.json");
  logged = [];
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function session(id: string): SessionRecord {
  return {
    id,
    engineSessionId: `engine-${id}`,
    engine: "claude-code",
    mode: "assistant",
    modelAlias: "default",
    effort: "default",
    startFolder: "/vault",
    projectId: null,
    clone: null,
    parentId: null,
    forkAtMessageId: null,
    forkFromEngineSessionId: null,
    title: `Chat ${id}`,
    createdAt: "2026-10-14T10:00:00.000Z",
    lastTurnAt: null,
    source: "cli",
    telegramTopicId: null,
    historyLost: false,
    turns: [],
    seenTurns: 0,
    archived: false,
    closed: false,
  };
}

function openStore(): SessionStore {
  return new SessionStore(path, {
    now: () => clock,
    logger: { log: (level, message) => logged.push(`${level} ${message}`) },
  });
}

function corruptCopies(): string[] {
  return readdirSync(folder).filter((name) => name.startsWith("sessions.json.corrupt-"));
}

describe("SessionStore", () => {
  test("keeps the sessions that it saved", () => {
    openStore().save(session("one"));
    expect(
      openStore()
        .list()
        .map((record) => record.id),
    ).toEqual(["one"]);
    expect(corruptCopies()).toEqual([]);
  });

  test("forgets a deleted session, also after a reload", () => {
    const store = openStore();
    store.save(session("one"));
    store.save(session("two"));
    store.delete("one");
    expect(store.get("one")).toBeUndefined();
    expect(
      openStore()
        .list()
        .map((record) => record.id),
    ).toEqual(["two"]);
  });

  test("an old turn with no activity counts loads them as 0, with no copy (lesson 69)", () => {
    const oldTurn = { userText: "hi", toolCount: 2, lastMessageId: null, at: "2026-10-14T10:00:00.000Z" };
    writeFileSync(path, JSON.stringify({ version: 1, sessions: [{ ...session("one"), turns: [oldTurn] }] }));
    expect(openStore().get("one")?.turns[0]).toMatchObject({
      toolCount: 2,
      commandCount: 0,
      taskCount: 0,
      steps: [],
      omittedSteps: 0,
      contextTokens: null,
      contextWindow: null,
      model: null,
    });
    expect(corruptCopies()).toEqual([]);
  });

  test("a session from before the seen count has every turn seen, with no copy (issue 381)", () => {
    const turn = { userText: "hi", lastMessageId: null, at: "2026-10-14T10:00:00.000Z" };
    const { seenTurns: _left, ...old } = { ...session("one"), turns: [turn, turn] };
    writeFileSync(path, JSON.stringify({ version: 1, sessions: [old] }));
    expect(openStore().get("one")?.seenTurns).toBe(2);
    expect(corruptCopies()).toEqual([]);
  });

  test("a session from before the effort, or with a bad one, uses the engine's default effort (#419)", () => {
    const { effort: _left, ...old } = session("one");
    writeFileSync(path, JSON.stringify({ version: 1, sessions: [old, { ...session("two"), effort: "huge" }] }));
    expect(openStore().get("one")?.effort).toBe("default");
    expect(openStore().get("two")?.effort).toBe("default");
    expect(corruptCopies()).toEqual([]);
  });

  test("a session from before the archive flag, or with a bad one, is not archived (issue 388)", () => {
    const { archived: _left, ...old } = session("one");
    writeFileSync(path, JSON.stringify({ version: 1, sessions: [old, { ...session("two"), archived: "yes" }] }));
    expect(openStore().get("one")?.archived).toBe(false);
    expect(openStore().get("two")?.archived).toBe(false);
    expect(corruptCopies()).toEqual([]);
  });

  test("a bad seen count keeps its session and counts every turn as seen", () => {
    const turn = { userText: "hi", lastMessageId: null, at: "2026-10-14T10:00:00.000Z" };
    writeFileSync(
      path,
      JSON.stringify({ version: 1, sessions: [{ ...session("one"), turns: [turn], seenTurns: -3 }] }),
    );
    expect(openStore().get("one")?.seenTurns).toBe(1);
    expect(corruptCopies()).toEqual([]);
  });

  test("a turn with a bad step list keeps its session and loses only its steps", () => {
    const turn = {
      userText: "hi",
      lastMessageId: null,
      at: "2026-10-14T10:00:00.000Z",
      steps: [{ kind: "renamed-kind", text: "x" }],
      omittedSteps: -1,
      contextTokens: "many",
      contextWindow: 0,
      model: 42,
    };
    writeFileSync(path, JSON.stringify({ version: 1, sessions: [{ ...session("one"), turns: [turn] }] }));
    expect(openStore().get("one")?.turns[0]).toMatchObject({
      steps: [],
      omittedSteps: 0,
      contextTokens: null,
      contextWindow: null,
      model: null,
    });
  });

  test("a turn from before the notes, or with bad notes, has none and keeps its session (issue 157)", () => {
    const turn = { userText: "hi", lastMessageId: null, at: "2026-10-14T10:00:00.000Z" };
    const sessions = [
      { ...session("one"), turns: [turn] },
      { ...session("two"), turns: [{ ...turn, notes: "lost" }] },
    ];
    writeFileSync(path, JSON.stringify({ version: 1, sessions }));
    expect(openStore().get("one")?.turns[0]?.notes).toEqual([]);
    expect(openStore().get("two")?.turns[0]?.notes).toEqual([]);
    expect(corruptCopies()).toEqual([]);
  });

  test("starts empty with no file, and makes no copy (lesson 54)", () => {
    expect(openStore().list()).toEqual([]);
    expect(corruptCopies()).toEqual([]);
    expect(logged).toEqual([]);
  });

  test("keeps the good sessions when one entry is bad, and copies the file first (lesson 69)", () => {
    const original = JSON.stringify({ version: 1, sessions: [session("one"), { id: "broken" }, session("two")] });
    writeFileSync(path, original);
    const store = openStore();
    expect(store.list().map((record) => record.id)).toEqual(["one", "two"]);
    expect(corruptCopies()).toEqual(["sessions.json.corrupt-2026-10-14T10-30-00-000Z"]);
    expect(readFileSync(join(folder, corruptCopies()[0] ?? ""), "utf-8")).toBe(original);
    expect(logged.join("\n")).toContain("warn");

    store.save(session("three"));
    expect(
      openStore()
        .list()
        .map((record) => record.id),
    ).toEqual(["one", "two", "three"]);
  });

  test("copies a file that is not JSON before the next save replaces it", () => {
    writeFileSync(path, "{ not json");
    const store = openStore();
    expect(store.list()).toEqual([]);
    store.save(session("one"));
    expect(readFileSync(join(folder, corruptCopies()[0] ?? ""), "utf-8")).toBe("{ not json");
  });

  test("starts with the good sessions even when the copy fails", () => {
    writeFileSync(path, JSON.stringify({ version: 1, sessions: [session("one"), 42] }));
    mkdirSync(join(folder, "sessions.json.corrupt-2026-10-14T10-30-00-000Z"));
    expect(
      openStore()
        .list()
        .map((record) => record.id),
    ).toEqual(["one"]);
    expect(logged.join("\n")).toContain("warn");
  });

  test("copies a file with an unknown shape", () => {
    writeFileSync(path, JSON.stringify({ version: 2, chats: [] }));
    expect(openStore().list()).toEqual([]);
    expect(corruptCopies()).toHaveLength(1);
  });
});
