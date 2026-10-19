import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionManager,
  type FirstTurn,
  type SessionManagerOptions,
  type TurnPreparer,
} from "../../../../src/core/sessions/session-manager.ts";
import { SessionStore } from "../../../../src/core/sessions/session-store.ts";
import type { SessionEvent } from "../../../../src/shared/events.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { Redactor } from "../../../../src/shared/redaction.ts";
import { FakeEngine } from "../../../support/fake-engine.ts";

let folder: string;
let events: SessionEvent[];
let followUps: (string | null)[];

const preparer: TurnPreparer = {
  prepare: (session) =>
    Promise.resolve({
      startFolder: session.startFolder,
      appendSystemPrompt: session.mode === "assistant" ? "You are Eva." : null,
      messagePrefix: null,
      pluginFolders: [],
      mcpServers: {},
      trusted: true,
      environment: { PATH: "/bin" },
    }),
  afterTurn: () => Promise.resolve(followUps.shift() ?? null),
};

function createManager(
  engine: FakeEngine,
  overrides: {
    approvalTimeoutMs?: number;
    redactor?: Redactor;
    turnTimeoutMs?: number;
    nameChat?: SessionManagerOptions["nameChat"];
  } = {},
): SessionManager {
  let nextId = 0;
  const manager = new SessionManager({
    engines: [engine],
    store: new SessionStore(join(folder, "sessions.json"), { now: () => new Date("2026-10-14T12:00:00Z") }),
    preparers: { assistant: preparer, project: preparer },
    now: () => new Date("2026-10-14T12:00:00Z"),
    newId: () => {
      nextId += 1;
      return `id-${String(nextId)}`;
    },
    redactor: overrides.redactor ?? new Redactor(),
    gatherMs: 5,
    approvalTimeoutMs: overrides.approvalTimeoutMs ?? 1_000,
    turnTimeoutMs: overrides.turnTimeoutMs ?? 30_000,
    ...(overrides.nameChat === undefined ? {} : { nameChat: overrides.nameChat }),
  });
  manager.subscribe((event) => events.push(event));
  return manager;
}

/** Polls with a deadline, so a regression fails fast instead of holding a turn open. */
async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("The condition never came true.");
    await Bun.sleep(5);
  }
}

function newAssistantSession(manager: SessionManager): string {
  return manager.createSession({
    mode: "assistant",
    engine: "claude-code",
    model: "default",
    startFolder: "/vault",
    source: "cli",
  }).id;
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-sessions-"));
  events = [];
  followUps = [];
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("a conversation", () => {
  test("the first turn starts a new engine session with the id Eva chose (lesson 44)", async () => {
    const engine = new FakeEngine();
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "Hello there, Eva");

    const record = manager.get(sessionId);
    expect(engine.requests[0]?.history).toEqual({ kind: "new", engineSessionId: record.engineSessionId });
    expect(engine.requests[0]?.appendSystemPrompt).toBe("You are Eva.");
    expect(record.title).toBe("Hello there, Eva");
    expect(record.turns).toEqual([
      {
        userText: "Hello there, Eva",
        answerText: "answer 1",
        toolCount: 0,
        commandCount: 0,
        taskCount: 0,
        steps: [{ kind: "message", text: "answer 1", isError: false, id: `${record.engineSessionId}:answer 1` }],
        omittedSteps: 0,
        contextTokens: 15,
        contextWindow: 200_000,
        failure: null,
        lastMessageId: `${record.engineSessionId}:answer 1`,
        at: "2026-10-14T12:00:00.000Z",
      },
    ]);
  });

  test("a turn keeps its steps in order, with the last message in full and a failed tool marked", async () => {
    const long = "y".repeat(300);
    const manager = createManager(
      new FakeEngine((request) => [
        { kind: "text", text: long, messageId: "m1" },
        { kind: "tool_started", toolUseId: "t1", name: "Bash", category: "command", summary: "npm test" },
        { kind: "tool_finished", toolUseId: "t1", isError: true },
        { kind: "task_changed", taskId: "k1", description: "look", state: "running" },
        ...FakeEngine.answer(request, long),
      ]),
    );
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "Run the tests.");
    const steps = manager.get(sessionId).turns[0]?.steps ?? [];
    expect(steps.map((step) => [step.kind, step.text.length, step.isError])).toEqual([
      ["message", 200, false],
      ["command", 8, true],
      ["task", 4, false],
      ["message", 300, false],
    ]);
  });

  test("a turn keeps its activity: every tool, the commands among them, and its background tasks", async () => {
    const manager = createManager(
      new FakeEngine((request) => [
        { kind: "tool_started", toolUseId: "t1", name: "Bash", category: "command", summary: "ls" },
        { kind: "tool_started", toolUseId: "t2", name: "Agent", category: "tool", summary: "Agent look" },
        { kind: "task_changed", taskId: "k1", description: "look", state: "running" },
        { kind: "task_changed", taskId: "k1", description: "look", state: "done" },
        { kind: "task_changed", taskId: "k2", description: "npm test", state: "running" },
        ...FakeEngine.answer(request, "done"),
      ]),
    );
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "Look around.");
    expect(manager.get(sessionId).turns[0]).toMatchObject({ toolCount: 2, commandCount: 1, taskCount: 2 });
  });

  test("a fixed title, such as a schedule's name, stays after the first turn", async () => {
    const manager = createManager(new FakeEngine());
    const { id } = manager.createSession({
      mode: "assistant",
      engine: "claude-code",
      model: "default",
      startFolder: "/vault",
      source: "schedule",
      title: "Morning",
    });
    await manager.send(id, "Plan my day.");
    expect(manager.get(id).title).toBe("Morning");
  });

  test("the next turn continues the same engine session", async () => {
    const engine = new FakeEngine();
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "one");
    await manager.send(sessionId, "two");
    expect(engine.requests[1]?.history).toEqual({
      kind: "continue",
      engineSessionId: manager.get(sessionId).engineSessionId,
    });
  });

  test("events carry the session id and a growing sequence number", async () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "one");
    expect(events.map((event) => [event.kind, event.sessionId])).toEqual([
      ["message_received", sessionId],
      ["text", sessionId],
      ["turn_finished", sessionId],
    ]);
    expect(events[2]!.seq).toBeGreaterThan(events[1]!.seq);
  });

  test("each message of a turn tells the front ends where it came from, redacted (lesson 95)", async () => {
    const redactor = new Redactor();
    redactor.addSecret("the-secret-value-123");
    const manager = createManager(new FakeEngine(), { redactor });
    const sessionId = newAssistantSession(manager);
    const first = manager.send(sessionId, "from the phone", "telegram");
    const second = manager.send(sessionId, "the key is the-secret-value-123");
    await Promise.all([first, second]);
    expect(events.map((event) => event.kind)).toEqual([
      "message_received",
      "message_received",
      "text",
      "turn_finished",
    ]);
    expect(events.slice(0, 2)).toMatchObject([
      { sessionId, text: "from the phone", origin: "telegram" },
      { sessionId, text: "the key is [redacted]", origin: "eva" },
    ]);
  });

  test("a message sent during a turn is told when its own turn starts, after the turn before (lesson 114)", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const manager = createManager(
      new FakeEngine(async function* (request, turnNumber) {
        if (turnNumber === 1) await held;
        yield* FakeEngine.answer(request, `answer ${String(turnNumber)}`);
      }),
    );
    const sessionId = newAssistantSession(manager);
    const first = manager.send(sessionId, "one", "telegram");
    for (let attempt = 0; attempt < 200 && !manager.isBusy(sessionId); attempt += 1) await Bun.sleep(5);
    const second = manager.send(sessionId, "two", "api");
    release();
    await Promise.all([first, second]);
    expect(events.map((event) => (event.kind === "message_received" ? `message ${event.text}` : event.kind))).toEqual([
      "message one",
      "text",
      "turn_finished",
      "message two",
      "text",
      "turn_finished",
    ]);
  });

  test("messages sent close together share one turn (lesson 51)", async () => {
    const engine = new FakeEngine();
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    await Promise.all([manager.send(sessionId, "first part"), manager.send(sessionId, "second part")]);
    expect(engine.requests.map((request) => request.prompt)).toEqual(["first part\n\nsecond part"]);
  });

  test("a message sent during a running turn waits and joins the next turn (lesson 114)", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request, turnNumber) {
      if (turnNumber === 1) await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, `answer ${String(turnNumber)}`);
    });
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    const firstTurn = manager.send(sessionId, "first");
    while (engine.requests.length === 0) await Bun.sleep(5);
    expect(manager.isBusy(sessionId)).toBe(true);
    const secondTurn = manager.send(sessionId, "second");
    const thirdTurn = manager.send(sessionId, "third");
    release();
    await Promise.all([firstTurn, secondTurn, thirdTurn]);
    expect(engine.requests.map((request) => request.prompt)).toEqual(["first", "second\n\nthird"]);
  });

  test("a chat with a gathered message is active before its turn starts, so an update waits (lesson 92)", async () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    expect(manager.isActive(sessionId)).toBe(false);
    const turn = manager.send(sessionId, "hello");
    expect(manager.isBusy(sessionId)).toBe(false);
    expect(manager.isActive(sessionId)).toBe(true);
    await turn;
    expect(manager.isActive(sessionId)).toBe(false);
  });

  test("an unknown session is an EvaError", () => {
    const manager = createManager(new FakeEngine());
    expect(() => manager.get("missing")).toThrow();
    const error: unknown = (() => {
      try {
        manager.get("missing");
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(isEvaError(error, "session_not_found")).toBe(true);
  });
});

describe("models (lesson 41)", () => {
  test("a chat's model is chosen before its first message, and fixed after it", async () => {
    const engine = new FakeEngine();
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    expect(manager.setModel(sessionId, "haiku").modelAlias).toBe("haiku");
    await manager.send(sessionId, "hi");
    expect(engine.requests[0]?.model).toBe("haiku");
    expect(() => manager.setModel(sessionId, "opus")).toThrow("before its first message");
  });
});

/** A namer that a test answers by hand, so it controls when the name arrives. */
function handNamer(): {
  readonly nameChat: (turn: FirstTurn) => Promise<string | null>;
  readonly asked: FirstTurn[];
  answer(name: string | null): Promise<void>;
} {
  const asked: FirstTurn[] = [];
  const waiting: ((name: string | null) => void)[] = [];
  return {
    asked,
    nameChat: (turn) => {
      asked.push(turn);
      return new Promise((resolve) => waiting.push(resolve));
    },
    async answer(name) {
      waiting.shift()?.(name);
      // The manager applies the name after the promise settles.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe("chat names from a model (issue 50)", () => {
  test("the first turn asks for a name, and the name replaces the first-line title", async () => {
    const namer = handNamer();
    const manager = createManager(new FakeEngine(), { nameChat: namer.nameChat });
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "Plan a trip to Rome\nwith the kids");
    // The turn never waits for the name.
    expect(manager.get(sessionId).title).toBe("Plan a trip to Rome");
    expect(namer.asked).toEqual([
      {
        engine: "claude-code",
        model: "default",
        userText: "Plan a trip to Rome\nwith the kids",
        answerText: "answer 1",
      },
    ]);
    await namer.answer("🇮🇹 Rome trip");
    expect(manager.get(sessionId).title).toBe("🇮🇹 Rome trip");
    expect(events.filter((event) => event.kind === "session_renamed")).toMatchObject([
      { kind: "session_renamed", title: "🇮🇹 Rome trip", automatic: true },
    ]);
  });

  test("a chat that the person renamed while the model thought keeps the person's title", async () => {
    const namer = handNamer();
    const manager = createManager(new FakeEngine(), { nameChat: namer.nameChat });
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "Plan a trip to Rome");
    manager.rename(sessionId, "Holidays");
    await namer.answer("Rome trip");
    expect(manager.get(sessionId).title).toBe("Holidays");
  });

  test("a chat whose first turn failed keeps the default title and asks no model, as before", async () => {
    const namer = handNamer();
    const failing = new FakeEngine((request, turnNumber) =>
      turnNumber === 1 ? [{ kind: "turn_failed", reason: "no" }] : FakeEngine.answer(request, "ok"),
    );
    const manager = createManager(failing, { nameChat: namer.nameChat });
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "first try");
    // The failed turn stays in the record, so the later answer is no first turn and names nothing.
    await manager.send(sessionId, "second try");
    expect(manager.get(sessionId).title).toBe("New chat");
    expect(namer.asked).toHaveLength(0);
  });

  test("a fixed title, an empty name, a later turn and a fork ask no model again", async () => {
    const namer = handNamer();
    const named = createManager(new FakeEngine(), { nameChat: namer.nameChat });
    const scheduled = named.createSession({
      mode: "assistant",
      engine: "claude-code",
      model: "default",
      startFolder: "/vault",
      source: "schedule",
      title: "Morning",
    }).id;
    await named.send(scheduled, "Good morning");
    expect(namer.asked).toHaveLength(0);

    const chat = newAssistantSession(named);
    await named.send(chat, "Hello there");
    await namer.answer(null);
    expect(named.get(chat).title).toBe("Hello there");
    await named.send(chat, "And more");
    const first = named.get(chat).turns[0]?.lastMessageId ?? "";
    await named.send(named.fork(chat, first).id, "Another way");
    expect(namer.asked).toHaveLength(1);
  });

  test("a namer that fails, or a name that cleans to nothing, keeps the first-line title and leaks no rejection", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", record);
    try {
      const failing = createManager(new FakeEngine(), { nameChat: () => Promise.reject(new Error("boom")) });
      const first = newAssistantSession(failing);
      await failing.send(first, "Hello there");
      // A blank name fails the title check inside the background step.
      const blank = createManager(new FakeEngine(), { nameChat: () => Promise.resolve(" \n ") });
      const second = newAssistantSession(blank);
      await blank.send(second, "Good morning");
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(failing.get(first).title).toBe("Hello there");
      expect(blank.get(second).title).toBe("Good morning");
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });

  test("a chat deleted before its name arrives stays deleted", async () => {
    const namer = handNamer();
    const manager = createManager(new FakeEngine(), { nameChat: namer.nameChat });
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "Hello there");
    manager.delete(sessionId);
    await namer.answer("Greeting");
    expect(manager.list()).toEqual([]);
  });
});

describe("renames (issue 46)", () => {
  test("a rename saves the title, tells every front end, and survives a restart", () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    expect(manager.rename(sessionId, "  Trip plans  ").title).toBe("Trip plans");
    expect(events).toMatchObject([{ kind: "session_renamed", sessionId, title: "Trip plans" }]);
    expect(createManager(new FakeEngine()).get(sessionId).title).toBe("Trip plans");
  });

  test("a renamed chat keeps its title after its first message", async () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    manager.rename(sessionId, "Trip plans");
    await manager.send(sessionId, "Hello there, Eva");
    expect(manager.get(sessionId).title).toBe("Trip plans");
  });

  test("a rename during a turn stays when the turn ends", async () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    const done = manager.send(sessionId, "Hello there, Eva");
    manager.rename(sessionId, "Trip plans");
    await done;
    expect(manager.get(sessionId).title).toBe("Trip plans");
  });

  test("a title is one line, cut to the title length, and redacted", () => {
    const redactor = new Redactor();
    redactor.addSecret("the-telegram-token-value");
    const manager = createManager(new FakeEngine(), { redactor });
    const sessionId = newAssistantSession(manager);
    expect(manager.rename(sessionId, "first\nsecond").title).toBe("first second");
    expect(manager.rename(sessionId, "x".repeat(80)).title).toBe(`${"x".repeat(59)}…`);
    expect(manager.rename(sessionId, "key the-telegram-token-value").title).toBe("key [redacted]");
  });

  test("a cut never splits an emoji", () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    expect(manager.rename(sessionId, `${"x".repeat(58)}🙂🙂🙂`).title).toBe(`${"x".repeat(58)}🙂…`);
  });

  test("the same title again tells the front ends again, so Telegram can retry a refused topic rename", () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    manager.rename(sessionId, "Trip plans");
    expect(manager.rename(sessionId, " Trip plans ").title).toBe("Trip plans");
    expect(events.filter((event) => event.kind === "session_renamed")).toHaveLength(2);
  });

  test("an empty title is refused", () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    let caught: unknown;
    try {
      manager.rename(sessionId, " \n ");
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "title_invalid")).toBe(true);
    expect(manager.get(sessionId).title).toBe("New chat");
    expect(events).toEqual([]);
  });
});

describe("event order", () => {
  test("a turn is in the session list before its turn_finished event goes out", async () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    const turnsSeen: number[] = [];
    manager.subscribe((event) => {
      if (event.kind === "turn_finished") turnsSeen.push(manager.get(sessionId).turns.length);
    });
    await manager.send(sessionId, "hi");
    expect(turnsSeen).toEqual([1]);
  });
});

describe("exactly one end event (lesson 47)", () => {
  test("a failed turn keeps its activity too", async () => {
    const manager = createManager(
      new FakeEngine(() => [
        { kind: "tool_started", toolUseId: "t1", name: "Bash", category: "command", summary: "ls" },
        { kind: "task_changed", taskId: "k1", description: "look", state: "running" },
        { kind: "turn_failed", reason: "boom" },
      ]),
    );
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "go");
    expect(manager.get(sessionId).turns[0]).toMatchObject({
      toolCount: 1,
      commandCount: 1,
      taskCount: 1,
      steps: [
        { kind: "command", text: "ls" },
        { kind: "task", text: "look" },
      ],
      contextTokens: null,
      contextWindow: null,
    });
    expect(manager.get(sessionId).turns[0]?.failure).not.toBeNull();
  });

  test("a stream that stops without an end gets one turn_failed", async () => {
    const manager = createManager(new FakeEngine(() => [{ kind: "text", text: "half", messageId: "m1" }]));
    await manager.send(newAssistantSession(manager), "go");
    expect(events.filter((event) => event.kind === "turn_failed" || event.kind === "turn_finished")).toHaveLength(1);
    expect(events.at(-1)?.kind).toBe("turn_failed");
  });

  test("an engine that throws gets one turn_failed, and the session is free again", async () => {
    const crashing: AsyncIterable<never> = {
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("engine crashed")) }),
    };
    const manager = createManager(new FakeEngine(() => crashing));
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "go");
    expect(events.map((event) => event.kind)).toEqual(["message_received", "turn_failed"]);
    expect(manager.isBusy(sessionId)).toBe(false);
  });

  test("events after the first end are dropped", async () => {
    const manager = createManager(
      new FakeEngine((request) => [
        ...FakeEngine.answer(request, "a"),
        { kind: "turn_failed", reason: "late" },
        { kind: "text", text: "late", messageId: "x" },
      ]),
    );
    await manager.send(newAssistantSession(manager), "go");
    expect(events.map((event) => event.kind)).toEqual(["message_received", "text", "turn_finished"]);
  });
});

describe("forks and retries", () => {
  test("a fork is a new session that branches at one message", async () => {
    const engine = new FakeEngine();
    const manager = createManager(engine);
    const parentId = newAssistantSession(manager);
    await manager.send(parentId, "one");
    const parent = manager.get(parentId);
    const atMessageId = parent.turns[0]!.lastMessageId!;

    const fork = manager.fork(parentId, atMessageId);
    expect(fork).toMatchObject({ parentId, forkAtMessageId: atMessageId, mode: "assistant", turns: [] });
    await manager.send(fork.id, "another path");
    expect(engine.requests[1]?.history).toEqual({
      kind: "fork",
      fromEngineSessionId: parent.engineSessionId,
      atMessageId,
    });
    expect(manager.get(fork.id).engineSessionId).toBe(`fork-of-${parent.engineSessionId}`);
    await manager.send(fork.id, "and on");
    expect(engine.requests[2]?.history).toEqual({
      kind: "continue",
      engineSessionId: `fork-of-${parent.engineSessionId}`,
    });
  });

  test("a retry of a later turn branches at the answer before it and sends the same text", async () => {
    const engine = new FakeEngine();
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "one");
    await manager.send(sessionId, "two");
    const original = manager.get(sessionId);

    const retry = await manager.retry(sessionId, 1);
    expect(engine.requests[2]?.prompt).toBe("two");
    expect(engine.requests[2]?.history).toEqual({
      kind: "fork",
      fromEngineSessionId: original.engineSessionId,
      atMessageId: original.turns[0]!.lastMessageId!,
    });
    expect(manager.get(retry.id).parentId).toBe(sessionId);
    expect(manager.get(sessionId).turns).toHaveLength(2);
  });

  test("a retry of the first turn starts a fresh session with the same text", async () => {
    const engine = new FakeEngine();
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "one");
    const retry = await manager.retry(sessionId, 0);
    expect(engine.requests[1]?.history.kind).toBe("new");
    expect(engine.requests[1]?.prompt).toBe("one");
    expect(manager.get(retry.id).parentId).toBe(sessionId);
  });

  test("a retry of a turn that does not exist is refused", async () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    const error: unknown = await manager.retry(sessionId, 3).catch((caught: unknown) => caught);
    expect((error as Error).message).toContain("no turn 3");
  });
});

describe("delete", () => {
  test("a delete removes the chat and its forks, and tells the front ends of each one", async () => {
    const manager = createManager(new FakeEngine());
    const rootId = newAssistantSession(manager);
    const otherId = newAssistantSession(manager);
    await manager.send(rootId, "one");
    const fork = manager.fork(rootId, manager.get(rootId).turns[0]!.lastMessageId!);
    const forkOfFork = manager.fork(fork.id, "message-1");
    events = [];

    expect(manager.delete(rootId).sort()).toEqual([rootId, fork.id, forkOfFork.id].sort());
    expect(manager.list().map((session) => session.id)).toEqual([otherId]);
    expect(events.map((event) => [event.kind, event.sessionId]).sort()).toEqual(
      [rootId, fork.id, forkOfFork.id].map((id) => ["session_deleted", id]).sort(),
    );
  });

  test("a delete of a chat that works, or of one of its forks that works, is refused", async () => {
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => request.signal.addEventListener("abort", () => resolve()));
      yield { kind: "turn_failed", reason: "The turn was stopped." };
    });
    const manager = createManager(engine);
    const rootId = newAssistantSession(manager);
    const fork = manager.fork(rootId, "message-1");
    const turn = manager.send(fork.id, "long work");

    let refused: unknown = null;
    try {
      manager.delete(rootId);
    } catch (error) {
      refused = error;
    }
    expect(isEvaError(refused, "session_busy")).toBe(true);
    expect(manager.list()).toHaveLength(2);
    for (let attempt = 0; attempt < 200 && !manager.stop(fork.id); attempt += 1) await Bun.sleep(5);
    await turn;
  });

  test("a delete removes the whole tree before any front end hears of it", () => {
    const manager = createManager(new FakeEngine());
    const rootId = newAssistantSession(manager);
    manager.fork(rootId, "message-1");
    const seen: number[] = [];
    manager.subscribe((event) => {
      if (event.kind === "session_deleted") seen.push(manager.list().length);
    });
    manager.delete(rootId);
    expect(seen).toEqual([0, 0]);
  });

  test("a delete of an unknown chat is an EvaError", () => {
    const manager = createManager(new FakeEngine());
    expect(() => manager.delete("nothing")).toThrow("No session nothing.");
  });
});

describe("approvals", () => {
  test("an engine's permission ask becomes an event, and the first answer wins", async () => {
    const answers: string[] = [];
    const engine = new FakeEngine(async function* (request) {
      answers.push(await request.requestApproval({ requestId: "ignored", toolName: "Bash", summary: "rm -rf build" }));
      yield* FakeEngine.answer(request, "done");
    });
    const manager = createManager(engine);
    manager.subscribe((event) => {
      if (event.kind === "approval_needed") {
        manager.answerApproval(event.requestId, "allow");
        manager.answerApproval(event.requestId, "deny");
      }
    });
    await manager.send(newAssistantSession(manager), "go");
    expect(answers).toEqual(["allow"]);
    expect(events.find((event) => event.kind === "approval_needed")).toMatchObject({
      toolName: "Bash",
      summary: "rm -rf build",
    });
    expect(events.filter((event) => event.kind === "approval_resolved")).toMatchObject([
      { answer: "allow", timedOut: false },
    ]);
  });

  test("an ask that nobody answers is denied after the timeout", async () => {
    const answers: string[] = [];
    const engine = new FakeEngine(async function* (request) {
      answers.push(await request.requestApproval({ requestId: "x", toolName: "Bash", summary: "push" }));
      yield* FakeEngine.answer(request, "done");
    });
    const manager = createManager(engine, { approvalTimeoutMs: 20 });
    await manager.send(newAssistantSession(manager), "go");
    expect(answers).toEqual(["deny"]);
    expect(events.find((event) => event.kind === "approval_resolved")).toMatchObject({
      answer: "deny",
      timedOut: true,
    });
  });

  function askingManager(
    answers: string[],
    overrides: { approvalTimeoutMs?: number; turnTimeoutMs?: number } = {},
  ): SessionManager {
    const asking: TurnPreparer = {
      prepare: async (session, context) => {
        answers.push(await context.ask("Trust this repository", "example"));
        return preparer.prepare(session, context);
      },
      afterTurn: () => Promise.resolve(null),
    };
    let nextId = 0;
    const manager = new SessionManager({
      engines: [new FakeEngine()],
      store: new SessionStore(join(folder, "sessions.json"), { now: () => new Date("2026-10-14T12:00:00Z") }),
      preparers: { assistant: asking, project: asking },
      now: () => new Date("2026-10-14T12:00:00Z"),
      newId: () => {
        nextId += 1;
        return `id-${String(nextId)}`;
      },
      redactor: new Redactor(),
      gatherMs: 5,
      approvalTimeoutMs: overrides.approvalTimeoutMs ?? 30_000,
      turnTimeoutMs: overrides.turnTimeoutMs ?? 30_000,
    });
    manager.subscribe((event) => events.push(event));
    return manager;
  }

  test("a mode's question that nobody answers tells the mode it expired, not that the person said no", async () => {
    const answers: string[] = [];
    const manager = askingManager(answers, { approvalTimeoutMs: 20 });
    await manager.send(newAssistantSession(manager), "go");
    expect(answers).toEqual(["expired"]);
  });

  test("a stop ends a mode's open question as expired at once", async () => {
    const answers: string[] = [];
    const manager = askingManager(answers);
    const sessionId = newAssistantSession(manager);
    const turn = manager.send(sessionId, "go");
    for (let attempt = 0; attempt < 200 && !events.some((event) => event.kind === "approval_needed"); attempt += 1) {
      await Bun.sleep(5);
    }
    expect(manager.stop(sessionId)).toBe(true);
    await turn;
    expect(answers).toEqual(["expired"]);
    expect(events.find((event) => event.kind === "approval_resolved")).toMatchObject({ answer: "deny" });
  });

  test("a mode's question that the person answers gets that answer", async () => {
    const answers: string[] = [];
    const manager = askingManager(answers);
    manager.subscribe((event) => {
      if (event.kind === "approval_needed") manager.answerApproval(event.requestId, "allow");
    });
    await manager.send(newAssistantSession(manager), "go");
    expect(answers).toEqual(["allow"]);
  });

  test("lists the approvals that wait for an answer, redacted, so a front end that reconnects sees them", async () => {
    const redactor = new Redactor();
    redactor.addSecret("the-secret-value-123");
    const engine = new FakeEngine(async function* (request) {
      await request.requestApproval({ requestId: "x", toolName: "Bash", summary: "echo the-secret-value-123" });
      yield* FakeEngine.answer(request, "done");
    });
    const manager = createManager(engine, { redactor });
    const sessionId = newAssistantSession(manager);
    const turn = manager.send(sessionId, "go");
    while (manager.pendingApprovals().length === 0) await Bun.sleep(5);
    const [pending] = manager.pendingApprovals();
    expect(pending).toEqual({
      requestId: expect.any(String) as string,
      sessionId,
      toolName: "Bash",
      summary: "echo [redacted]",
    });
    manager.answerApproval(pending?.requestId ?? "", "allow");
    await turn;
    expect(manager.pendingApprovals()).toEqual([]);
  });
});

describe("background tasks", () => {
  test("a front end that missed the events reads the tasks of a running turn, in their last state", async () => {
    const redactor = new Redactor();
    redactor.addSecret("the-secret-value");
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = createManager(
      new FakeEngine(async function* (request) {
        yield { kind: "task_changed", taskId: "k1", description: "look", state: "running" };
        yield { kind: "task_changed", taskId: "k1", description: "looked", state: "done" };
        yield { kind: "task_changed", taskId: "k2", description: "echo the-secret-value", state: "running" };
        await released;
        yield* FakeEngine.answer(request, "done");
      }),
      { redactor },
    );
    const sessionId = newAssistantSession(manager);
    const turn = manager.send(sessionId, "go");
    try {
      await waitUntil(() => manager.backgroundTasks().tasks.length === 2);
      // The page drops a snapshot older than an event that it already has.
      expect(manager.backgroundTasks().seq).toBe(events.at(-1)?.seq ?? -1);
      expect(manager.backgroundTasks().tasks).toEqual([
        { taskId: "k1", sessionId, description: "looked", state: "done" },
        { taskId: "k2", sessionId, description: "echo [redacted]", state: "running" },
      ]);
    } finally {
      release();
      await turn;
    }
    expect(manager.backgroundTasks().tasks).toEqual([]);
  });

  test("the end event forgets the tasks, also while the engine stream still closes", async () => {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = createManager(
      new FakeEngine(async function* (request) {
        yield { kind: "task_changed", taskId: "k1", description: "look", state: "running" };
        yield* FakeEngine.answer(request, "done");
        await released;
      }),
    );
    const sessionId = newAssistantSession(manager);
    const turn = manager.send(sessionId, "go");
    try {
      await waitUntil(() => events.some((event) => event.kind === "turn_finished"));
      expect(manager.backgroundTasks().tasks).toEqual([]);
    } finally {
      release();
      await turn;
    }
  });

  test("two chats may use the same task id", async () => {
    const releases: (() => void)[] = [];
    const manager = createManager(
      new FakeEngine(async function* (request) {
        yield { kind: "task_changed", taskId: "k1", description: request.prompt, state: "running" };
        await new Promise<void>((resolve) => releases.push(resolve));
        yield* FakeEngine.answer(request, "done");
      }),
    );
    const first = newAssistantSession(manager);
    const second = newAssistantSession(manager);
    const turns = [manager.send(first, "one"), manager.send(second, "two")];
    try {
      await waitUntil(() => releases.length === 2);
      // The second chat's turn ends first: the first chat's task still runs.
      releases[1]?.();
      await turns[1];
      expect(manager.backgroundTasks().tasks).toEqual([
        { taskId: "k1", sessionId: first, description: "one", state: "running" },
      ]);
    } finally {
      for (const release of releases) release();
      await Promise.all(turns);
    }
  });

  test("a stopped turn forgets its tasks", async () => {
    const manager = createManager(
      new FakeEngine(async function* (request) {
        yield { kind: "task_changed", taskId: "k1", description: "look", state: "running" };
        await new Promise<void>((resolve) => request.signal.addEventListener("abort", () => resolve()));
        throw new Error("stopped");
      }),
    );
    const sessionId = newAssistantSession(manager);
    const turn = manager.send(sessionId, "go");
    await waitUntil(() => manager.backgroundTasks().tasks.length === 1);
    manager.stop(sessionId);
    await turn;
    expect(manager.backgroundTasks().tasks).toEqual([]);
  });

  test("a failed turn forgets its tasks, because the engine process ends with the turn", async () => {
    const manager = createManager(
      new FakeEngine(() => [
        { kind: "task_changed", taskId: "k1", description: "look", state: "running" },
        { kind: "turn_failed", reason: "boom" },
      ]),
    );
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "go");
    expect(manager.backgroundTasks().tasks).toEqual([]);
  });
});

describe("after a turn", () => {
  test("a follow-up message from the mode goes to the same session as the next turn", async () => {
    followUps = ["continue the skill run", null];
    const engine = new FakeEngine();
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "start the skill");
    expect(engine.requests.map((request) => request.prompt)).toEqual(["start the skill", "continue the skill run"]);
    expect(engine.requests[1]?.history.kind).toBe("continue");
  });
});

describe("persistence and redaction", () => {
  test("a second manager on the same store sees the sessions", async () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "keep me");
    const reloaded = createManager(new FakeEngine());
    expect(reloaded.get(sessionId).turns[0]?.userText).toBe("keep me");
    expect(reloaded.list().map((session) => session.id)).toEqual([sessionId]);
  });

  test("a secret in an event is redacted before any front end sees it (lesson 95)", async () => {
    const redactor = new Redactor();
    redactor.addSecret("the-telegram-token-value");
    const manager = createManager(
      new FakeEngine((request) => FakeEngine.answer(request, "token: the-telegram-token-value")),
      { redactor },
    );
    await manager.send(newAssistantSession(manager), "show it");
    expect(events[1]).toMatchObject({ kind: "text", text: "token: [redacted]" });
  });
});

describe("stops, failures and lost histories (security and lesson review)", () => {
  function waitForAbort(request: { signal: AbortSignal }): Promise<void> {
    return new Promise((resolve) => {
      request.signal.addEventListener("abort", () => {
        resolve();
      });
    });
  }

  test("stop aborts the running turn, and the failure stays in the history with its reason", async () => {
    const engine = new FakeEngine(async function* (request) {
      await waitForAbort(request);
      yield { kind: "turn_failed", reason: "The turn was stopped." };
    });
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    expect(manager.stop(sessionId)).toBe(false);
    const turn = manager.send(sessionId, "long work");
    for (let attempt = 0; attempt < 200 && !manager.stop(sessionId); attempt += 1) await Bun.sleep(5);
    await turn;
    expect(manager.get(sessionId).turns).toMatchObject([
      { userText: "long work", failure: "The turn was stopped.", lastMessageId: null },
    ]);
  });

  test("a turn that runs past the timeout is stopped", async () => {
    const engine = new FakeEngine(async function* (request) {
      await waitForAbort(request);
      yield { kind: "turn_failed", reason: "aborted" };
    });
    const manager = createManager(engine, { turnTimeoutMs: 20 });
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "hang");
    expect(manager.isBusy(sessionId)).toBe(false);
  });

  test("failed first turn, then a second message: the second continues the engine session that the first created", async () => {
    const engine = new FakeEngine((request, turnNumber) =>
      turnNumber === 1
        ? [
            { kind: "text", text: "Starting.", messageId: "m1" },
            { kind: "turn_failed", reason: "The turn was stopped." },
          ]
        : FakeEngine.answer(request, "ok"),
    );
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "one");
    await manager.send(sessionId, "two");
    expect(engine.requests[0]?.history.kind).toBe("new");
    expect(engine.requests[1]?.history).toEqual({
      kind: "continue",
      engineSessionId: manager.get(sessionId).engineSessionId,
    });
  });

  test("after a failed first turn that never created the engine session, the engine's lost-history retry stays silent", async () => {
    const engine = new FakeEngine((request, turnNumber) =>
      turnNumber === 1
        ? [{ kind: "turn_failed", reason: "offline" }]
        : [{ kind: "history_lost" }, ...FakeEngine.answer(request, "ok")],
    );
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "one");
    await manager.send(sessionId, "two");
    expect(engine.requests[1]?.history.kind).toBe("continue");
    expect(events.some((event) => event.kind === "history_lost")).toBe(false);
    expect(manager.get(sessionId)).toMatchObject({ historyLost: false });
  });

  test("a fork whose first turn failed forks again on the next message", async () => {
    const engine = new FakeEngine((request, turnNumber) =>
      turnNumber === 2 ? [{ kind: "turn_failed", reason: "offline" }] : FakeEngine.answer(request, "ok"),
    );
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "one");
    const atMessageId = manager.get(sessionId).turns[0]?.lastMessageId ?? "";
    const fork = manager.fork(sessionId, atMessageId);
    await manager.send(fork.id, "two");
    await manager.send(fork.id, "three");
    expect(engine.requests[2]?.history).toMatchObject({ kind: "fork", atMessageId });
  });

  test("a lost history that the retry could not replace starts a new engine session next time (lesson 46)", async () => {
    const engine = new FakeEngine((request, turnNumber) => {
      if (turnNumber === 2) return [{ kind: "history_lost" }, { kind: "turn_failed", reason: "still failing" }];
      return FakeEngine.answer(request, `answer ${String(turnNumber)}`);
    });
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "one");
    const firstEngineId = manager.get(sessionId).engineSessionId;
    await manager.send(sessionId, "two");
    expect(manager.get(sessionId)).toMatchObject({ historyLost: true });
    await manager.send(sessionId, "three");
    const third = engine.requests[2]?.history;
    expect(third?.kind).toBe("new");
    expect(third).not.toEqual({ kind: "new", engineSessionId: firstEngineId });
    expect(manager.get(sessionId).historyLost).toBe(false);
  });

  test("the model cannot change while the first turn runs (lesson 41)", async () => {
    let release = (): void => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      yield* FakeEngine.answer(request, "ok");
    });
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    const turn = manager.send(sessionId, "hi");
    for (let attempt = 0; attempt < 200 && engine.requests.length === 0; attempt += 1) await Bun.sleep(5);
    expect(() => manager.setModel(sessionId, "opus")).toThrow("before its first message");
    release();
    await turn;
  });

  test("a secret in a message or an answer is redacted in the saved history too (lesson 95)", async () => {
    const redactor = new Redactor();
    redactor.addSecret("the-secret-value-123");
    const manager = createManager(
      new FakeEngine((request) => FakeEngine.answer(request, "it is the-secret-value-123")),
      { redactor },
    );
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "remember the-secret-value-123");
    expect(manager.get(sessionId).turns[0]).toMatchObject({
      userText: "remember [redacted]",
      answerText: "it is [redacted]",
    });
  });

  test("a secret in a step is redacted before the step is cut (lesson 95)", async () => {
    const secret = "the-secret-value-123";
    const redactor = new Redactor();
    redactor.addSecret(secret);
    // The secret crosses the 200-character cut, so a cut before the redaction would keep half of it.
    const summary = `${"a".repeat(190)}${secret}`;
    const manager = createManager(
      new FakeEngine((request) => [
        { kind: "tool_started", toolUseId: "t1", name: "Bash", category: "command", summary },
        { kind: "task_changed", taskId: "k1", description: `look for ${secret}`, state: "running" },
        ...FakeEngine.answer(request, "ok"),
      ]),
      { redactor },
    );
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "go");
    const stored = JSON.stringify(manager.get(sessionId).turns[0]?.steps);
    expect(stored).not.toContain("the-secret");
    expect(stored).toContain("look for [redacted]");
  });
});
