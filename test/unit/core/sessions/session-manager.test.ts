import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionManager,
  type FirstTurn,
  type SessionManagerOptions,
  type TurnPreparer,
} from "../../../../src/core/sessions/session-manager.ts";
import { SessionStore } from "../../../../src/core/sessions/session-store.ts";
import { StepDetailsStore } from "../../../../src/core/sessions/step-details-store.ts";
import type { EngineEventPayload, SessionEvent } from "../../../../src/shared/events.ts";
import { maxDetailLength, maxTurnDetailLength } from "../../../../src/shared/tool-details.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { Redactor } from "../../../../src/shared/redaction.ts";
import { FakeEngine } from "../../../support/fake-engine.ts";

let folder: string;
let events: SessionEvent[];
let followUps: (string | null)[];
/** The next work after a turn throws this error once, such as a vault save that breaks. */
let afterTurnError: Error | null;
let logged: string[];

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
  afterTurn: () => {
    const error = afterTurnError;
    afterTurnError = null;
    return error === null ? Promise.resolve(followUps.shift() ?? null) : Promise.reject(error);
  },
};

function createManager(
  engine: FakeEngine,
  overrides: {
    approvalTimeoutMs?: number;
    redactor?: Redactor;
    turnTimeoutMs?: number;
    nameChat?: SessionManagerOptions["nameChat"];
    /** Where the ids start, so a second manager on the same store makes new ones. */
    firstId?: number;
  } = {},
): SessionManager {
  let nextId = overrides.firstId ?? 0;
  const manager = new SessionManager({
    engines: [engine],
    store: new SessionStore(join(folder, "sessions.json"), { now: () => new Date("2026-10-14T12:00:00Z") }),
    preparers: { assistant: preparer, project: preparer },
    stepDetails: new StepDetailsStore(join(folder, "step-details")),
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
    logger: { log: (level, message, details) => logged.push(`${level} ${message} ${JSON.stringify(details)}`) },
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
  afterTurnError = null;
  logged = [];
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
        model: "claude-opus-5-5",
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

  test("a tool step's whole input and output are redacted, sent, and kept apart from the session list", async () => {
    const redactor = new Redactor();
    redactor.addSecret("the-secret-value-123");
    const output = `token the-secret-value-123 ${"z".repeat(5000)}`;
    const manager = createManager(
      new FakeEngine((request) => [
        {
          kind: "tool_started",
          toolUseId: "t1",
          name: "Read",
          category: "tool",
          summary: "Read x",
          input: '{\n  "x": 1\n}',
        },
        { kind: "tool_finished", toolUseId: "t1", isError: false, output },
        ...FakeEngine.answer(request, "Done."),
      ]),
      { redactor },
    );
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "Read it.");
    const redacted = output.replace("the-secret-value-123", "[redacted]");
    expect(events.find((event) => event.kind === "tool_finished")).toMatchObject({ output: redacted });
    expect(manager.get(sessionId).turns[0]?.steps[0]).toEqual({
      kind: "tool",
      text: "Read x",
      isError: false,
      id: "t1",
    });
    expect(manager.stepDetail(sessionId, "t1")).toEqual({ input: '{\n  "x": 1\n}', output: redacted });
    manager.delete(sessionId);
    expect(new StepDetailsStore(join(folder, "step-details")).get(sessionId, "t1")).toBeNull();
  });

  test("a secret with a quote or a new line is redacted in a tool's JSON input too", async () => {
    const redactor = new Redactor();
    const secret = 'line-one-of-the-key\nline "two" of the key';
    redactor.addSecret(secret);
    const manager = createManager(
      new FakeEngine((request) => [
        {
          kind: "tool_started",
          toolUseId: "t1",
          name: "Write",
          category: "tool",
          summary: "Write key.pem",
          input: JSON.stringify({ file_path: "key.pem", content: secret }, null, 2),
        },
        ...FakeEngine.answer(request, "Done."),
      ]),
      { redactor },
    );
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "Write the key.");
    const sent = events.find((event) => event.kind === "tool_started");
    expect(sent).toMatchObject({ input: JSON.stringify({ file_path: "key.pem", content: "[redacted]" }, null, 2) });
  });

  test("a turn keeps whole details only up to its budget, so a long turn cannot fill the memory", async () => {
    const big = "b".repeat(maxDetailLength);
    const tools = Array.from({ length: 8 }, (_, index) => [
      { kind: "tool_started", toolUseId: `t${String(index)}`, name: "Read", category: "tool", summary: "Read x" },
      { kind: "tool_finished", toolUseId: `t${String(index)}`, isError: false, output: big },
    ]).flat() as EngineEventPayload[];
    const manager = createManager(new FakeEngine((request) => [...tools, ...FakeEngine.answer(request, "Done.")]));
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "Read them all.");
    const kept = events.filter((event) => event.kind === "tool_finished" && event.output !== undefined);
    expect(kept).toHaveLength(maxTurnDetailLength / maxDetailLength);
    expect(manager.stepDetail(sessionId, "t7")).toBeNull();
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
      // Telegram showed the first answer.
      "session_seen",
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

  test("a turn runs until its end event, though the chat stays busy for the work after the turn", async () => {
    let release: () => void = () => undefined;
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => (release = resolve));
      yield* FakeEngine.answer(request, "done");
    });
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    // A front end reads the list again on the end event, so the list must say the turn ended.
    const atEnd: boolean[] = [];
    manager.subscribe((event) => {
      if (event.kind === "turn_finished") atEnd.push(manager.isTurnRunning(sessionId), manager.isBusy(sessionId));
    });
    expect(manager.isTurnRunning(sessionId)).toBe(false);
    const turn = manager.send(sessionId, "go");
    await waitUntil(() => engine.requests.length > 0);
    expect(manager.isTurnRunning(sessionId)).toBe(true);
    release();
    await turn;
    expect(atEnd).toEqual([false, true]);
    expect(manager.isTurnRunning(sessionId)).toBe(false);
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

  test("a chat's effort goes to each turn, and changes between turns (#419)", async () => {
    const engine = new FakeEngine();
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    expect(manager.get(sessionId).effort).toBe("default");
    expect(manager.setEffort(sessionId, "low").effort).toBe("low");
    await manager.send(sessionId, "one");
    expect(manager.setEffort(sessionId, "max").effort).toBe("max");
    await manager.send(sessionId, "two");
    expect(engine.requests.map((request) => request.effort)).toEqual(["low", "max"]);
  });

  test("a chat's engine is chosen before its first message, and fixed after it", async () => {
    const engine = new FakeEngine();
    const manager = createManager(engine);
    const sessionId = manager.createSession({
      mode: "assistant",
      engine: "pi",
      model: "default",
      startFolder: "/vault",
      source: "web",
    }).id;
    expect(manager.setEngine(sessionId, "claude-code").engine).toBe("claude-code");
    await manager.send(sessionId, "hi");
    expect(engine.requests).toHaveLength(1);
    expect(() => manager.setEngine(sessionId, "claude-code")).toThrow("before its first message");
  });

  test("the engine of a chat must be on this machine", () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    const error: unknown = (() => {
      try {
        manager.setEngine(sessionId, "pi");
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(isEvaError(error, "engine_failed")).toBe(true);
    expect(manager.get(sessionId).engine).toBe("claude-code");
  });

  test("a fork keeps the engine of its chat, because it continues the chat's engine session", async () => {
    const manager = createManager(new FakeEngine());
    const parentId = newAssistantSession(manager);
    await manager.send(parentId, "hi");
    const fork = manager.fork(parentId, manager.get(parentId).turns[0]?.lastMessageId ?? "");
    expect(() => manager.setEngine(fork.id, "claude-code")).toThrow("A fork keeps");
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

describe("archived chats (issue 388)", () => {
  test("an archive saves the flag, tells every front end, and survives a restart", () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    expect(manager.get(sessionId).archived).toBe(false);
    expect(manager.setArchived(sessionId, true).archived).toBe(true);
    expect(events).toMatchObject([{ kind: "session_archived", sessionId, archived: true }]);
    expect(createManager(new FakeEngine()).get(sessionId).archived).toBe(true);
    expect(manager.setArchived(sessionId, false).archived).toBe(false);
  });

  test("a flag that changes nothing tells no front end", () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    manager.setArchived(sessionId, false);
    expect(events).toEqual([]);
  });

  test("a new message brings an archived chat back", async () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    manager.setArchived(sessionId, true);
    await manager.send(sessionId, "Hello again");
    expect(manager.get(sessionId).archived).toBe(false);
    expect(events.filter((event) => event.kind === "session_archived")).toMatchObject([
      { archived: true },
      { archived: false },
    ]);
  });

  test("a new message in a fork brings its archived chat back", async () => {
    const manager = createManager(new FakeEngine());
    const parentId = newAssistantSession(manager);
    await manager.send(parentId, "one");
    const fork = manager.fork(parentId, manager.get(parentId).turns[0]?.lastMessageId ?? "");
    manager.setArchived(parentId, true);
    await manager.send(fork.id, "another path");
    expect(manager.get(parentId).archived).toBe(false);
  });

  test("an archive of an unknown chat is refused", () => {
    const manager = createManager(new FakeEngine());
    let caught: unknown;
    try {
      manager.setArchived("missing", true);
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "session_not_found")).toBe(true);
  });
});

describe("seen turns (issue 381)", () => {
  test("a new chat has no unseen turn, and an answer is unseen until the person sees it", async () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    expect(manager.get(sessionId).seenTurns).toBe(0);
    await manager.send(sessionId, "Hello there, Eva");
    expect(manager.get(sessionId)).toMatchObject({ seenTurns: 0, turns: [{}] });
    expect(manager.markSeen(sessionId, 1).seenTurns).toBe(1);
    expect(events.filter((event) => event.kind === "session_seen")).toMatchObject([
      { kind: "session_seen", sessionId, seenTurns: 1 },
    ]);
    expect(createManager(new FakeEngine()).get(sessionId).seenTurns).toBe(1);
  });

  test("the count never goes back, and never past the stored turns", async () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "one");
    await manager.send(sessionId, "two");
    manager.markSeen(sessionId, 2);
    // A page that loaded before the second answer sends an old count.
    expect(manager.markSeen(sessionId, 1).seenTurns).toBe(2);
    // A count from the future cannot hide a turn that ends later.
    expect(manager.markSeen(sessionId, 9).seenTurns).toBe(2);
  });

  test("a count that changes nothing tells no front end", async () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "one");
    events = [];
    manager.markSeen(sessionId, 0);
    manager.markSeen(sessionId, 1);
    manager.markSeen(sessionId, 1);
    expect(events.filter((event) => event.kind === "session_seen")).toHaveLength(1);
  });

  test("an answer to a Telegram message is seen, because Telegram showed it", async () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "from the phone", "telegram");
    expect(manager.get(sessionId).seenTurns).toBe(1);
    await manager.send(sessionId, "from the web app", "api");
    expect(manager.get(sessionId).seenTurns).toBe(1);
  });

  test("a missing chat is refused", () => {
    const manager = createManager(new FakeEngine());
    let caught: unknown;
    try {
      manager.markSeen("missing", 1);
    } catch (error) {
      caught = error;
    }
    expect(isEvaError(caught, "session_not_found")).toBe(true);
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
    await waitUntil(() => !manager.isActive(retry.id));
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
    await waitUntil(() => !manager.isActive(retry.id));
    expect(engine.requests[1]?.history.kind).toBe("new");
    expect(engine.requests[1]?.prompt).toBe("one");
    expect(manager.get(retry.id).parentId).toBe(sessionId);
  });

  test("a retry answers with its branch at once, before the turn ends", async () => {
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine = new FakeEngine(async function* (request, turnNumber) {
      if (turnNumber === 2) await released;
      yield* FakeEngine.answer(request, "done");
    });
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "one");
    const retry = await manager.retry(sessionId, 0);
    expect(manager.isActive(retry.id)).toBe(true);
    expect(retry.turns).toEqual([]);
    release();
    await waitUntil(() => !manager.isActive(retry.id));
    expect(manager.get(retry.id).turns).toHaveLength(1);
  });

  test("a retry after a failed turn branches at the newest answer before it, so the history stays", async () => {
    const engine = new FakeEngine((request, turnNumber) =>
      turnNumber === 2 ? [{ kind: "turn_failed", reason: "offline" }] : FakeEngine.answer(request, "ok"),
    );
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "one");
    await manager.send(sessionId, "two");
    await manager.send(sessionId, "three");
    const original = manager.get(sessionId);
    expect(original.turns[1]?.lastMessageId).toBeNull();

    const retry = await manager.retry(sessionId, 2);
    await waitUntil(() => !manager.isActive(retry.id));
    expect(engine.requests[3]?.prompt).toBe("three");
    expect(engine.requests[3]?.history).toEqual({
      kind: "fork",
      fromEngineSessionId: original.engineSessionId,
      atMessageId: original.turns[0]!.lastMessageId!,
    });
  });

  test("a retry of a fork's first turn branches where the fork did, so the parent's history stays", async () => {
    const engine = new FakeEngine();
    const manager = createManager(engine);
    const parentId = newAssistantSession(manager);
    await manager.send(parentId, "one");
    const parent = manager.get(parentId);
    const atMessageId = parent.turns[0]!.lastMessageId!;
    const fork = manager.fork(parentId, atMessageId);
    await manager.send(fork.id, "another path");

    const retry = await manager.retry(fork.id, 0);
    await waitUntil(() => !manager.isActive(retry.id));
    expect(engine.requests[2]?.prompt).toBe("another path");
    expect(engine.requests[2]?.history).toEqual({
      kind: "fork",
      fromEngineSessionId: parent.engineSessionId,
      atMessageId,
    });
    expect(manager.get(retry.id)).toMatchObject({ parentId, forkAtMessageId: atMessageId });
  });

  test("a retry of the first turn of a fork of a fork branches the middle fork where the last one did", async () => {
    const engine = new FakeEngine();
    const manager = createManager(engine);
    const rootId = newAssistantSession(manager);
    await manager.send(rootId, "one");
    const middle = manager.fork(rootId, manager.get(rootId).turns[0]!.lastMessageId!);
    await manager.send(middle.id, "two");
    const middleRecord = manager.get(middle.id);
    const atMessageId = middleRecord.turns[0]!.lastMessageId!;
    const last = manager.fork(middle.id, atMessageId);
    await manager.send(last.id, "three");

    const retry = await manager.retry(last.id, 0);
    await waitUntil(() => !manager.isActive(retry.id));
    expect(engine.requests[3]?.prompt).toBe("three");
    expect(engine.requests[3]?.history).toEqual({
      kind: "fork",
      fromEngineSessionId: middleRecord.engineSessionId,
      atMessageId,
    });
    expect(manager.get(retry.id)).toMatchObject({ parentId: middle.id, forkAtMessageId: atMessageId });
  });

  test("a retry of a fork whose parent is gone starts from nothing, as a root chat does", async () => {
    const engine = new FakeEngine();
    const first = createManager(engine);
    const parentId = newAssistantSession(first);
    await first.send(parentId, "one");
    const fork = first.fork(parentId, first.get(parentId).turns[0]!.lastMessageId!);
    await first.send(fork.id, "another path");
    // Only a damaged file holds a fork without its parent: a delete removes the forks too.
    new SessionStore(join(folder, "sessions.json"), { now: () => new Date("2026-10-14T12:00:00Z") }).delete(parentId);
    const manager = createManager(engine, { firstId: 100 });

    const retry = await manager.retry(fork.id, 0);
    await waitUntil(() => !manager.isActive(retry.id));
    expect(engine.requests[2]?.history.kind).toBe("new");
    expect(manager.get(retry.id).parentId).toBe(fork.id);
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
    overrides: {
      approvalTimeoutMs?: number;
      turnTimeoutMs?: number;
      engine?: FakeEngine;
      /** The mode waits for it before it asks, as for a vault pull. */
      beforeAsk?: Promise<void>;
    } = {},
  ): SessionManager {
    const asking: TurnPreparer = {
      prepare: async (session, context) => {
        await overrides.beforeAsk;
        answers.push(await context.ask("Trust this repository", "example"));
        return preparer.prepare(session, context);
      },
      afterTurn: () => Promise.resolve(null),
    };
    let nextId = 0;
    const manager = new SessionManager({
      engines: [overrides.engine ?? new FakeEngine()],
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

  test("a stop before the mode asks expires the question at once, and the engine never starts", async () => {
    const answers: string[] = [];
    let pulled = (): void => undefined;
    const beforeAsk = new Promise<void>((resolve) => {
      pulled = resolve;
    });
    const engine = new FakeEngine();
    const manager = askingManager(answers, { engine, beforeAsk });
    const sessionId = newAssistantSession(manager);
    const turn = manager.send(sessionId, "go");
    await waitUntil(() => manager.isTurnRunning(sessionId));
    expect(manager.stop(sessionId)).toBe(true);
    pulled();
    await turn;
    expect(answers).toEqual(["expired"]);
    expect(events.some((event) => event.kind === "approval_needed")).toBe(false);
    expect(manager.pendingApprovals()).toEqual([]);
    expect(engine.requests).toEqual([]);
    expect(manager.get(sessionId).turns).toMatchObject([{ failure: "The turn stopped before the engine started." }]);
  });

  test("a time-out while the mode prepares says so, not that someone stopped the turn", async () => {
    const answers: string[] = [];
    const engine = new FakeEngine();
    const manager = askingManager(answers, { engine, beforeAsk: Bun.sleep(60), turnTimeoutMs: 20 });
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "go");
    expect(answers).toEqual(["expired"]);
    expect(engine.requests).toEqual([]);
    expect(manager.get(sessionId).turns).toMatchObject([
      { failure: "The turn ran past its time limit before the engine started." },
    ]);
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

describe("running turns", () => {
  test("a front end that missed the events reads the steps of a running turn, redacted", async () => {
    const redactor = new Redactor();
    redactor.addSecret("the-secret-value");
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = createManager(
      new FakeEngine(async function* (request) {
        yield { kind: "text", text: "First block with the-secret-value.", messageId: "m1" };
        yield { kind: "tool_started", toolUseId: "t1", name: "Bash", category: "command", summary: "ls" };
        await released;
        yield* FakeEngine.answer(request, "done");
      }),
      { redactor },
    );
    const sessionId = newAssistantSession(manager);
    const turn = manager.send(sessionId, "go");
    try {
      await waitUntil(() => events.some((event) => event.kind === "tool_started"));
      // The page replays only the events newer than the snapshot.
      expect(manager.runningTurns().seq).toBe(events.at(-1)?.seq ?? -1);
      expect(manager.runningTurns().turns).toEqual([
        {
          sessionId,
          steps: [
            { kind: "message", text: "First block with [redacted].", isError: false, id: "m1" },
            { kind: "command", text: "ls", isError: false, id: "t1" },
          ],
          draft: "",
        },
      ]);
    } finally {
      release();
      await turn;
    }
    expect(manager.runningTurns().turns).toEqual([]);
  });

  test("the snapshot holds the sent text of the block that the engine writes now", async () => {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = createManager(
      new FakeEngine(async function* (request) {
        yield { kind: "text_delta", text: "Old try ", startsBlock: true };
        yield { kind: "text_delta", text: "Here is ", startsBlock: true };
        yield { kind: "text_delta", text: "the answer so far " };
        await released;
        yield* FakeEngine.answer(request, "Here is the answer so far.");
      }),
    );
    const sessionId = newAssistantSession(manager);
    const turn = manager.send(sessionId, "go");
    try {
      await waitUntil(() => events.filter((event) => event.kind === "text_delta").length === 3);
      expect(manager.runningTurns().turns).toEqual([{ sessionId, steps: [], draft: "Here is the answer so far " }]);
    } finally {
      release();
      await turn;
    }
  });

  test("the end event forgets the steps, also while the engine stream still closes", async () => {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = createManager(
      new FakeEngine(async function* (request) {
        yield* FakeEngine.answer(request, "done");
        await released;
      }),
    );
    const sessionId = newAssistantSession(manager);
    const turn = manager.send(sessionId, "go");
    try {
      await waitUntil(() => events.some((event) => event.kind === "turn_finished"));
      expect(manager.runningTurns().turns).toEqual([]);
    } finally {
      release();
      await turn;
    }
  });

  test("a failed turn forgets its steps", async () => {
    const manager = createManager(
      new FakeEngine(() => [
        { kind: "text", text: "partly", messageId: "m1" },
        { kind: "turn_failed", reason: "boom" },
      ]),
    );
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "go");
    expect(manager.runningTurns().turns).toEqual([]);
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

  test("a send with a result gives the failure of its own turn, though a later message's turn succeeds", async () => {
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine = new FakeEngine(async function* (request, turnNumber) {
      if (turnNumber === 1) {
        await released;
        yield { kind: "turn_failed", reason: "You hit the usage limit." };
        return;
      }
      yield* FakeEngine.answer(request, "ok");
    });
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    const scheduled = manager.sendWithResult(sessionId, "Plan my day.", "schedule");
    await waitUntil(() => engine.requests.length === 1);
    const personal = manager.send(sessionId, "And the weather?", "api");
    release();
    expect(await scheduled).toBe("You hit the usage limit.");
    await personal;
    expect(manager.get(sessionId).turns.map((turn) => turn.failure)).toEqual(["You hit the usage limit.", null]);
  });

  test("a send with a result gives null when the person stopped its turn: a stop is no failure", async () => {
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => {
        request.signal.addEventListener("abort", () => {
          resolve();
        });
      });
      yield { kind: "turn_failed", reason: "The turn was stopped." };
    });
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    const scheduled = manager.sendWithResult(sessionId, "Plan my day.", "schedule");
    await waitUntil(() => engine.requests.length === 1);
    manager.stop(sessionId);
    expect(await scheduled).toBeNull();
  });

  test("a send with a result gives null for a good turn, though a follow-up of the mode fails", async () => {
    followUps = ["continue the skill run", null];
    const engine = new FakeEngine((request, turnNumber) =>
      turnNumber === 1 ? FakeEngine.answer(request, "ok") : [{ kind: "turn_failed", reason: "offline" }],
    );
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    expect(await manager.sendWithResult(sessionId, "start the skill", "schedule")).toBeNull();
    expect(engine.requests).toHaveLength(2);
  });

  test("a send with a result gives the failure even when the failed turn cannot be saved", async () => {
    const engine = new FakeEngine(() => {
      // A folder where the session list was: each save of the list fails.
      const listPath = join(folder, "sessions.json");
      rmSync(listPath, { force: true });
      mkdirSync(listPath);
      return [{ kind: "turn_failed", reason: "You hit the usage limit." }];
    });
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    expect(await manager.sendWithResult(sessionId, "Plan my day.", "schedule")).toBe("You hit the usage limit.");
    expect(logged.join("\n")).toContain("The work after a turn failed.");
  });

  test("a good answer that cannot be saved is a failure: the result says so, and no follow-up starts", async () => {
    followUps = ["continue the skill run"];
    const engine = new FakeEngine((request) => {
      const listPath = join(folder, "sessions.json");
      rmSync(listPath, { force: true });
      mkdirSync(listPath);
      return FakeEngine.answer(request, "ok");
    });
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    const failure = await manager.sendWithResult(sessionId, "Plan my day.", "schedule");
    expect(failure).not.toBeNull();
    expect(events.filter((event) => event.kind === "turn_failed")).toHaveLength(1);
    expect(events.some((event) => event.kind === "turn_finished")).toBe(false);
    expect(engine.requests).toHaveLength(1);
  });

  test("an error after a turn is logged, and a message that waits still gets its turn", async () => {
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine = new FakeEngine(async function* (request, turnNumber) {
      if (turnNumber === 1) await released;
      yield* FakeEngine.answer(request, "done");
    });
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    afterTurnError = new Error("The vault save broke.");
    const first = manager.send(sessionId, "one");
    await waitUntil(() => engine.requests.length === 1);
    const second = manager.send(sessionId, "two");
    release();
    await Promise.all([first, second]);
    await waitUntil(() => !manager.isActive(sessionId));
    expect(engine.requests.map((request) => request.prompt)).toEqual(["one", "two"]);
    expect(manager.get(sessionId).turns).toHaveLength(2);
    expect(logged.join("\n")).toContain("The vault save broke.");
  });

  test("a listener that throws breaks no turn: each message still gets its turn", async () => {
    const engine = new FakeEngine();
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    let thrown = false;
    manager.subscribe((event) => {
      if (thrown || event.kind !== "message_received") return;
      thrown = true;
      // A message that comes while the chat is busy, just before the throw.
      void manager.send(sessionId, "two");
      throw new Error("A front end broke.");
    });
    const later: string[] = [];
    manager.subscribe((event) => later.push(event.kind));
    await manager.send(sessionId, "one");
    await waitUntil(() => !manager.isActive(sessionId));
    expect(engine.requests.map((request) => request.prompt)).toEqual(["one", "two"]);
    expect(logged.join("\n")).toContain("A front end broke.");
    // A listener after the broken one still hears each event.
    expect(later.filter((kind) => kind === "message_received" || kind === "turn_finished")).toEqual([
      "message_received",
      "turn_finished",
      "message_received",
      "turn_finished",
    ]);
  });

  test("a listener that always throws is logged once, and once again after it worked in between", async () => {
    const manager = createManager(new FakeEngine());
    const sessionId = newAssistantSession(manager);
    let broken = true;
    manager.subscribe(() => {
      if (broken) throw new Error("A front end broke.");
    });
    await manager.send(sessionId, "one");
    const failures = (): number => logged.filter((line) => line.includes("A front end broke.")).length;
    expect(failures()).toBe(1);
    broken = false;
    await manager.send(sessionId, "two");
    broken = true;
    await manager.send(sessionId, "three");
    expect(failures()).toBe(2);
  });

  test("a stopped turn gets no follow-up from the mode", async () => {
    followUps = ["continue the skill run"];
    const engine = new FakeEngine(async function* (request) {
      await new Promise<void>((resolve) => {
        request.signal.addEventListener("abort", () => {
          resolve();
        });
      });
      yield { kind: "turn_failed", reason: "The turn was stopped." };
    });
    const manager = createManager(engine);
    const sessionId = newAssistantSession(manager);
    const turn = manager.send(sessionId, "start the skill");
    await waitUntil(() => manager.isTurnRunning(sessionId) && engine.requests.length === 1);
    manager.stop(sessionId);
    await turn;
    expect(engine.requests.map((request) => request.prompt)).toEqual(["start the skill"]);
    expect(manager.isActive(sessionId)).toBe(false);
  });

  test("the idle listener hears once, after the follow-ups, and hears whether the person stopped a turn", async () => {
    followUps = ["continue the skill run", null];
    const manager = createManager(new FakeEngine());
    const idle: [string, boolean, number][] = [];
    manager.onIdle((sessionId, { stopped }) => {
      idle.push([sessionId, stopped, engineTurns(events)]);
    });
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "start the skill");
    expect(idle).toEqual([[sessionId, false, 2]]);

    const slow = createManager(
      new FakeEngine((request, turnNumber) =>
        turnNumber === 1 || turnNumber === 3
          ? (async function* () {
              yield { kind: "text", text: "Working", messageId: "m1" } as const;
              await Bun.sleep(2_000);
            })()
          : FakeEngine.answer(request, "done"),
      ),
    );
    const stopped: boolean[] = [];
    slow.onIdle((_, state) => stopped.push(state.stopped));
    // The second manager makes the same session ids, so the old events must not count.
    events.length = 0;
    const slowId = newAssistantSession(slow);
    const turn = slow.send(slowId, "go");
    await waitUntil(() => events.some((event) => event.sessionId === slowId && event.kind === "text"));
    slow.stop(slowId);
    await turn;
    await slow.send(slowId, "again");
    expect(stopped).toEqual([true, false]);

    // A message that waits while the person stops the turn is new work: its answer is no stop.
    events.length = 0;
    const long = slow.send(slowId, "a long task");
    await waitUntil(() => events.some((event) => event.kind === "text"));
    const queued = slow.send(slowId, "the next task");
    slow.stop(slowId);
    await Promise.all([long, queued]);
    expect(stopped).toEqual([true, false, false]);
  });
});

function engineTurns(seen: readonly SessionEvent[]): number {
  return seen.filter((event) => event.kind === "turn_finished" || event.kind === "turn_failed").length;
}

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

describe("streamed text", () => {
  test("sends the pieces of a block redacted and held back, and keeps only the final text", async () => {
    const redactor = new Redactor();
    redactor.addSecret("the-secret-value");
    const manager = createManager(
      new FakeEngine((request) => [
        { kind: "text_delta", text: "Your key is the-sec" },
        { kind: "text_delta", text: "ret-value and more " },
        { kind: "text_delta", text: "words to come " },
        ...FakeEngine.answer(request, "Your key is the-secret-value and more words to come."),
      ]),
      { redactor },
    );
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "go");
    const pieces = events.filter((event) => event.kind === "text_delta").map((event) => event.text);
    // The stream holds back one character less than the longest secret.
    expect(pieces.join("")).toBe("Your key is [redacted] and ");
    const turn = manager.get(sessionId).turns[0];
    expect(turn?.answerText).toBe("Your key is [redacted] and more words to come.");
    expect(turn?.steps.map((step) => step.kind)).toEqual(["message"]);
  });

  test("a new block after a final text starts from nothing", async () => {
    const manager = createManager(
      new FakeEngine((request) => [
        { kind: "text_delta", text: "First block " },
        { kind: "text", text: "First block.", messageId: "m1" },
        { kind: "text_delta", text: "Second block " },
        ...FakeEngine.answer(request, "Second block."),
      ]),
    );
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "go");
    expect(events.filter((event) => event.kind === "text_delta").map((event) => event.text)).toEqual([
      "First block ",
      "Second block ",
    ]);
  });
});

describe("a block that starts again", () => {
  test("drops the pieces before it and marks its first sent piece", async () => {
    const manager = createManager(
      new FakeEngine((request) => [
        { kind: "text_delta", text: "Hello w", startsBlock: true },
        // The model call failed and runs again: its block starts with a word still held back.
        { kind: "text_delta", text: "Hel", startsBlock: true },
        { kind: "text_delta", text: "lo world " },
        ...FakeEngine.answer(request, "Hello world."),
      ]),
    );
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "go");
    expect(
      events.filter((event) => event.kind === "text_delta").map(({ text, startsBlock }) => ({ text, startsBlock })),
    ).toEqual([
      { text: "Hello ", startsBlock: true },
      { text: "Hello world ", startsBlock: true },
    ]);
  });
});

describe("a final text during the next block", () => {
  test("a final text that comes during the next block never splits a secret in that block", async () => {
    const token = `ghp_${"a".repeat(36)}`;
    const manager = createManager(
      new FakeEngine((request) => [
        { kind: "text_delta", text: "First. ", startsBlock: true },
        { kind: "text_delta", text: `Then ${token.slice(0, 20)}`, startsBlock: true },
        { kind: "text", text: "First.", messageId: "m1" },
        { kind: "text_delta", text: `${token.slice(20)} and more words to come here ` },
        ...FakeEngine.answer(request, `Then ${token} and more words to come here.`),
      ]),
    );
    const sessionId = newAssistantSession(manager);
    await manager.send(sessionId, "go");
    const sent = events.filter((event) => event.kind === "text_delta").map((event) => event.text);
    expect(sent.join("")).not.toContain("aaaa");
  });
});

describe("one turn per clone (issue 356)", () => {
  function newProjectSession(manager: SessionManager, folder: string): string {
    return manager.createSession({
      mode: "project",
      engine: "claude-code",
      model: "default",
      startFolder: folder,
      source: "cli",
      projectId: "2025-03-02-1015-example-app",
      clone: "example-app-0",
    }).id;
  }

  /** An engine whose "long" turns wait for `release`, and that counts the most turns that ran at once. */
  function heldEngine(): { engine: FakeEngine; release: () => void; mostAtOnce: () => number } {
    let open: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (open = resolve));
    let running = 0;
    let most = 0;
    const engine = new FakeEngine(async function* (request, turnNumber) {
      running += 1;
      most = Math.max(most, running);
      try {
        if (request.prompt === "long") await held;
        if (request.prompt === "fail") throw new Error("The engine broke.");
        // A short pause, so a second turn that runs at the same time shows in the count.
        await Bun.sleep(5);
        yield* FakeEngine.answer(request, `answer ${String(turnNumber)}`);
      } finally {
        running -= 1;
      }
    });
    return { engine, release: () => open(), mostAtOnce: () => most };
  }

  test("a turn waits while another chat runs a turn in the same clone, says why, and then starts", async () => {
    const { engine, release } = heldEngine();
    const manager = createManager(engine);
    const first = newProjectSession(manager, "/clones/example-app-0");
    const second = newProjectSession(manager, "/clones/example-app-0");
    const running = manager.send(first, "long");
    await waitUntil(() => engine.requests.length === 1);
    const waiting = manager.send(second, "short");
    await waitUntil(() => events.some((event) => event.sessionId === second && event.kind === "notice"));
    expect(engine.requests.map((request) => request.prompt)).toEqual(["long"]);
    expect(manager.isTurnRunning(second)).toBe(true);
    release();
    await Promise.all([running, waiting]);
    expect(engine.requests.map((request) => request.prompt)).toEqual(["long", "short"]);
    expect(manager.get(second).turns[0]?.failure).toBeNull();
  });

  test("a wait never blocks another clone or an Assistant chat", async () => {
    const { engine, release } = heldEngine();
    const manager = createManager(engine);
    const running = manager.send(newProjectSession(manager, "/clones/example-app-0"), "long");
    await waitUntil(() => engine.requests.length === 1);
    await manager.send(newProjectSession(manager, "/clones/example-app-1"), "other clone");
    // Every Assistant chat runs at the vault root. Eva's vault sync handles them, so they never wait.
    const assistantRunning = manager.send(newAssistantSession(manager), "long");
    await waitUntil(() => engine.requests.length === 3);
    await manager.send(newAssistantSession(manager), "second assistant");
    release();
    await Promise.all([running, assistantRunning]);
    expect(events.some((event) => event.kind === "notice")).toBe(false);
  });

  test("a stop of the waiting chat ends the wait, and its turn never reaches the engine", async () => {
    const { engine, release } = heldEngine();
    const manager = createManager(engine);
    const first = newProjectSession(manager, "/clones/example-app-0");
    const second = newProjectSession(manager, "/clones/example-app-0");
    const running = manager.send(first, "long");
    await waitUntil(() => engine.requests.length === 1);
    const waiting = manager.send(second, "short");
    await waitUntil(() => events.some((event) => event.sessionId === second && event.kind === "notice"));
    expect(manager.stop(second)).toBe(true);
    await waiting;
    expect(manager.get(second).turns[0]?.failure).toContain("stopped");
    release();
    await running;
    expect(engine.requests.map((request) => request.prompt)).toEqual(["long"]);
  });

  test("a stop sent from the notice event ends the wait at once", async () => {
    const { engine, release } = heldEngine();
    const manager = createManager(engine);
    const first = newProjectSession(manager, "/clones/example-app-0");
    const second = newProjectSession(manager, "/clones/example-app-0");
    manager.subscribe((event) => {
      if (event.sessionId === second && event.kind === "notice") manager.stop(second);
    });
    const running = manager.send(first, "long");
    await waitUntil(() => engine.requests.length === 1);
    await manager.send(second, "short");
    expect(manager.get(second).turns[0]?.failure).toContain("stopped");
    release();
    await running;
  });

  test("several waiting chats run one after the other", async () => {
    const { engine, release, mostAtOnce } = heldEngine();
    const manager = createManager(engine);
    const ids = [0, 1, 2].map(() => newProjectSession(manager, "/clones/example-app-0"));
    const running = manager.send(ids[0] ?? "", "long");
    await waitUntil(() => engine.requests.length === 1);
    const others = [manager.send(ids[1] ?? "", "two"), manager.send(ids[2] ?? "", "three")];
    await waitUntil(() => events.filter((event) => event.kind === "notice").length === 2);
    release();
    await Promise.all([running, ...others]);
    expect(engine.requests.map((request) => request.prompt).sort()).toEqual(["long", "three", "two"]);
    expect(mostAtOnce()).toBe(1);
  });

  test("a turn that fails frees the clone for the waiting turn", async () => {
    const { engine } = heldEngine();
    const manager = createManager(engine);
    const first = newProjectSession(manager, "/clones/example-app-0");
    const second = newProjectSession(manager, "/clones/example-app-0");
    await Promise.all([manager.send(first, "fail"), manager.send(second, "short")]);
    expect(manager.get(first).turns[0]?.failure).toContain("broke");
    expect(manager.get(second).turns[0]?.failure).toBeNull();
  });

  test("a waiting turn gets its whole time-out after the wait", async () => {
    const { engine, release } = heldEngine();
    const manager = createManager(engine, { turnTimeoutMs: 400 });
    const first = newProjectSession(manager, "/clones/example-app-0");
    const second = newProjectSession(manager, "/clones/example-app-0");
    const running = manager.send(first, "long");
    await waitUntil(() => engine.requests.length === 1);
    const waiting = manager.send(second, "short");
    // Longer than the time-out: a timer that started before the wait would stop the waiting turn.
    await Bun.sleep(500);
    release();
    await Promise.all([running, waiting]);
    expect(manager.get(second).turns[0]?.failure).toBeNull();
  });
});

describe("recent activity (issue 356)", () => {
  test("a chat counts as active after its creation, a message and a turn, until the time passes", async () => {
    let clock = new Date("2026-10-14T12:00:00Z");
    let nextId = 0;
    let open: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (open = resolve));
    const engine = new FakeEngine(async function* (request) {
      await held;
      yield* FakeEngine.answer(request, "done");
    });
    const manager = new SessionManager({
      engines: [engine],
      store: new SessionStore(join(folder, "sessions.json"), { now: () => clock }),
      preparers: { assistant: preparer, project: preparer },
      now: () => clock,
      newId: () => `id-${String((nextId += 1))}`,
      redactor: new Redactor(),
      gatherMs: 5,
      approvalTimeoutMs: 1_000,
      turnTimeoutMs: 30_000,
    });
    const tenMinutes = 10 * 60_000;
    const sessionId = newAssistantSession(manager);
    expect(manager.hadActivityWithin(sessionId, tenMinutes)).toBe(true);
    clock = new Date("2026-10-14T12:10:01Z");
    expect(manager.hadActivityWithin(sessionId, tenMinutes)).toBe(false);
    const turn = manager.send(sessionId, "hello");
    await waitUntil(() => engine.requests.length === 1);
    // The turn has not ended, so only the message and the turn start explain this.
    clock = new Date("2026-10-14T12:19:00Z");
    expect(manager.hadActivityWithin(sessionId, tenMinutes)).toBe(true);
    clock = new Date("2026-10-14T12:30:00Z");
    open();
    await turn;
    // Only the turn end explains this.
    clock = new Date("2026-10-14T12:39:00Z");
    expect(manager.hadActivityWithin(sessionId, tenMinutes)).toBe(true);
    clock = new Date("2026-10-14T12:40:01Z");
    expect(manager.hadActivityWithin(sessionId, tenMinutes)).toBe(false);
    expect(manager.hadActivityWithin("missing", tenMinutes)).toBe(false);
  });
});
