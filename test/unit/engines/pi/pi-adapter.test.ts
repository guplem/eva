/**
 * Contract tests for the pi adapter on records captured from pi 0.73.1 against a fake model
 * server (test/fixtures/pi/). A live run with a real login is issue #59.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvalTitle } from "../../../../src/engines/pi/pi-approval-extension.ts";
import { buildPiArguments, PiEngine } from "../../../../src/engines/pi/pi-adapter.ts";
import type { ApprovalAnswer, ApprovalRequest, TurnRequest } from "../../../../src/shared/engine-port.ts";
import type { EngineEventPayload } from "../../../../src/shared/events.ts";
import { FakePi, loadPiFixture, type PiRecord } from "../../../support/fake-pi.ts";

let folder: string;
let sessions: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-pi-"));
  sessions = join(folder, "pi", "sessions");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function request(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    mode: "assistant",
    history: { kind: "new", engineSessionId: "session-1" },
    startFolder: "/demo-vault",
    prompt: "Hello",
    model: "default",
    appendSystemPrompt: "You are Eva.",
    pluginFolders: ["/demo-vault/.eva"],
    mcpServers: {},
    trusted: true,
    environment: { PATH: "/bin" },
    requestApproval: () => Promise.resolve<ApprovalAnswer>("allow"),
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** A session file as pi writes it: a header, then entries chained by parentId. */
function sessionFile(id: string, entries: { id: string; role: string }[]): void {
  mkdirSync(sessions, { recursive: true });
  const lines: object[] = [{ type: "session", version: 3, id: "header", cwd: "/demo-vault" }];
  let parentId: string | null = null;
  for (const entry of entries) {
    lines.push({ type: "message", id: entry.id, parentId, message: { role: entry.role } });
    parentId = entry.id;
  }
  writeFileSync(join(sessions, `${id}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
}

function writesSession(id: string, entries: { id: string; role: string }[]): () => void {
  return () => {
    sessionFile(id, entries);
  };
}

function engine(fake: FakePi, overrides: Partial<ConstructorParameters<typeof PiEngine>[0]> = {}): PiEngine {
  return new PiEngine({
    command: ["pi"],
    workFolder: join(folder, "pi"),
    models: { default: null, opus: null, sonnet: null, haiku: null },
    start: fake.start,
    newSessionId: () => "fork-1",
    now: () => new Date("2026-10-15T08:00:00Z"),
    ...overrides,
  });
}

async function drain(events: AsyncIterable<EngineEventPayload>): Promise<EngineEventPayload[]> {
  const all: EngineEventPayload[] = [];
  for await (const event of events) all.push(event);
  return all;
}

function withCommand(records: readonly PiRecord[], from: string, to: string): PiRecord[] {
  return records.map((record) => JSON.parse(JSON.stringify(record).replaceAll(from, to)) as PiRecord);
}

describe("buildPiArguments", () => {
  const inputs = {
    sessionFile: "/eva/pi/sessions/session-1.jsonl",
    sessionsFolder: "/eva/pi/sessions",
    extensionFile: "/eva/pi/eva-approval-extension.ts",
    promptFile: "/eva/pi/prompts/session-1.md",
    model: null,
  };
  const base = [
    "--mode",
    "rpc",
    "--session",
    "/eva/pi/sessions/session-1.jsonl",
    "--session-dir",
    "/eva/pi/sessions",
    "--offline",
    "-e",
    "/eva/pi/eva-approval-extension.ts",
  ];

  test("Assistant mode: Eva's prompt and skills, and no extension but Eva's", () => {
    expect(buildPiArguments(request(), inputs)).toEqual([
      ...base,
      "--no-extensions",
      "--append-system-prompt",
      "/eva/pi/prompts/session-1.md",
      "--skill",
      join("/demo-vault/.eva", "skills"),
    ]);
  });

  test("Project mode is pi as a manual session; an untrusted clone loses its extensions", () => {
    const project = request({ mode: "project", appendSystemPrompt: null, pluginFolders: [] });
    expect(buildPiArguments(project, { ...inputs, promptFile: null })).toEqual(base);
    expect(buildPiArguments({ ...project, trusted: false }, { ...inputs, promptFile: null })).toEqual([
      ...base,
      "--no-extensions",
    ]);
  });

  test("a configured model is passed through", () => {
    const project = request({ mode: "project", appendSystemPrompt: null });
    expect(buildPiArguments(project, { ...inputs, promptFile: null, model: "openai/gpt-5" })).toEqual([
      ...base,
      "--model",
      "openai/gpt-5",
    ]);
  });
});

describe("PiEngine", () => {
  test("a plain turn: the answer, the summed usage and cost, and the entry id of the answer", async () => {
    const fake = new FakePi([
      {
        records: loadPiFixture("plain"),
        onClose: writesSession("session-1", [
          { id: "u1", role: "user" },
          { id: "a1", role: "assistant" },
        ]),
      },
    ]);
    const events = await drain(engine(fake).runTurn(request({ prompt: "plain hello" })));
    expect(events[0]).toMatchObject({ kind: "text", messageId: "session-1:1" });
    expect(events.at(-1)).toMatchObject({
      kind: "turn_finished",
      engineSessionId: "session-1",
      lastMessageId: "a1",
      usage: { inputTokens: 1000, outputTokens: 20, cacheReadTokens: 200, cacheWriteTokens: 0 },
      contextTokens: 1200,
    });
    expect((events.at(-1) as { costUsd: number }).costUsd).toBeGreaterThan(0);
    const run = fake.runs[0];
    if (run === undefined) throw new Error("pi never started");
    expect(run.sent[0]).toEqual({ id: "eva-prompt", type: "prompt", message: "plain hello" });
    expect(run.command[0]).toBe("pi");
    expect(run.cwd).toBe("/demo-vault");
    expect(run.environment).toEqual({ PATH: "/bin" });
  });

  test("the chat's model name picks the pi model, with the default entry as fallback (lesson 41)", async () => {
    const fake = new FakePi([{ records: loadPiFixture("plain") }, { records: loadPiFixture("plain") }]);
    const models = { default: "openai/gpt-5-mini", opus: "openai/gpt-5", sonnet: null, haiku: null };
    await drain(engine(fake, { models }).runTurn(request({ model: "opus" })));
    await drain(engine(fake, { models }).runTurn(request({ model: "sonnet" })));
    expect(fake.runs.map((run) => run.command[run.command.indexOf("--model") + 1])).toEqual([
      "openai/gpt-5",
      "openai/gpt-5-mini",
    ]);
  });

  test("Eva writes her extension and the turn's prompt file, and keeps them when nothing changed", async () => {
    const fake = new FakePi([{ records: loadPiFixture("plain") }, { records: loadPiFixture("plain") }]);
    await drain(engine(fake).runTurn(request()));
    await drain(engine(fake).runTurn(request()));
    expect(readFileSync(join(folder, "pi", "eva-approval-extension.ts"), "utf8")).toContain(approvalTitle);
    expect(readFileSync(join(folder, "pi", "prompts", "session-1.md"), "utf8")).toBe("You are Eva.");
  });

  test("a tool call becomes tool events with a readable summary", async () => {
    const fake = new FakePi([{ records: loadPiFixture("tool-call") }]);
    const events = await drain(engine(fake).runTurn(request()));
    expect(events.filter((event) => event.kind.startsWith("tool"))).toEqual([
      { kind: "tool_started", toolUseId: "call_fake_29", name: "bash", category: "command", summary: "echo hi" },
      { kind: "tool_finished", toolUseId: "call_fake_29", isError: false },
    ]);
    expect(events.at(-1)).toMatchObject({ kind: "turn_finished", lastMessageId: null });
  });

  test("the context is the last answer's input, not the sum over the turn", async () => {
    let answer = 0;
    const records = loadPiFixture("tool-call").map((record) => {
      const message = record["message"] as { role?: string; usage?: object } | undefined;
      if (record["type"] !== "message_end" || message?.role !== "assistant") return record;
      answer += 1;
      const usage = { ...message.usage, input: answer * 100, cacheRead: 10, cacheWrite: 1 };
      return { ...record, message: { ...message, usage } };
    });
    const events = await drain(engine(new FakePi([{ records }])).runTurn(request()));
    expect(answer).toBeGreaterThan(1);
    expect(events.at(-1)).toMatchObject({ kind: "turn_finished", contextTokens: answer * 100 + 11 });
  });

  test("Assistant mode allows a local command at once, and asks the person before an outward one", async () => {
    const asked: ApprovalRequest[] = [];
    const ask = (approval: ApprovalRequest): Promise<ApprovalAnswer> => {
      asked.push(approval);
      return Promise.resolve("deny");
    };
    const local = new FakePi([{ records: loadPiFixture("approval-denied") }]);
    await drain(engine(local).runTurn(request({ requestApproval: ask })));
    expect(local.runs[0]?.sent[1]).toMatchObject({ type: "extension_ui_response", confirmed: true });
    expect(asked).toEqual([]);

    const outward = new FakePi([
      { records: withCommand(loadPiFixture("approval-denied"), "rm -rf ./scratch-dir", "git push origin main") },
    ]);
    await drain(engine(outward).runTurn(request({ requestApproval: ask })));
    expect(asked).toEqual([{ requestId: "", toolName: "bash", summary: "git push origin main" }]);
    expect(outward.runs[0]?.sent[1]).toMatchObject({ type: "extension_ui_response", confirmed: false });
  });

  test("Project mode runs pi's tools without a question, as pi itself does", async () => {
    const asked: string[] = [];
    const fake = new FakePi([{ records: loadPiFixture("approval-allowed") }]);
    await drain(
      engine(fake).runTurn(
        request({
          mode: "project",
          appendSystemPrompt: null,
          requestApproval: (approval) => {
            asked.push(approval.summary);
            return Promise.resolve("deny");
          },
        }),
      ),
    );
    expect(asked).toEqual([]);
    expect(fake.runs[0]?.sent[1]).toMatchObject({ type: "extension_ui_response", confirmed: true });
  });

  test("a dialog from another extension is cancelled, and a notice needs no answer", async () => {
    const records = loadPiFixture("approval-allowed").map((record) =>
      record["type"] === "extension_ui_request" ? { ...record, method: "select", title: "Pick one" } : record,
    );
    records.splice(1, 0, { type: "extension_ui_request", id: "n1", method: "notify", message: "hi" });
    const fake = new FakePi([{ records }]);
    await drain(engine(fake).runTurn(request()));
    const answers = fake.runs[0]?.sent.filter((record) => record["type"] === "extension_ui_response");
    expect(answers).toEqual([{ type: "extension_ui_response", id: expect.any(String) as string, cancelled: true }]);
  });

  test("a broken approval message is read as an unknown local tool", async () => {
    const records = loadPiFixture("approval-allowed").map((record) =>
      record["type"] === "extension_ui_request" ? { ...record, message: "not json" } : record,
    );
    const fake = new FakePi([{ records }]);
    await drain(engine(fake).runTurn(request()));
    expect(fake.runs[0]?.sent[1]).toMatchObject({ type: "extension_ui_response", confirmed: true });
  });

  test("a retried 500 that fails again ends the turn once, with pi's error (lesson 47)", async () => {
    const fake = new FakePi([{ records: loadPiFixture("error-500") }]);
    const events = await drain(engine(fake).runTurn(request()));
    const ends = events.filter((event) => event.kind === "turn_finished" || event.kind === "turn_failed");
    expect(ends).toEqual([{ kind: "turn_failed", reason: "500 fake upstream exploded" }]);
    expect(fake.runs[0]?.sent.filter((record) => record["type"] === "get_state")).toHaveLength(2);
  });

  test("a 401 is not retried and fails the turn", async () => {
    const fake = new FakePi([{ records: loadPiFixture("error-401") }]);
    const events = await drain(engine(fake).runTurn(request()));
    expect(events.at(-1)).toMatchObject({ kind: "turn_failed", reason: expect.stringContaining("401") as string });
  });

  test("a stop sends abort to pi, and the aborted answer fails the turn", async () => {
    const controller = new AbortController();
    const fake = new FakePi([{ records: loadPiFixture("abort") }]);
    const events: EngineEventPayload[] = [];
    for await (const event of engine(fake).runTurn(request({ signal: controller.signal }))) {
      events.push(event);
      controller.abort();
    }
    expect(fake.runs[0]?.sent).toContainEqual({ type: "abort" });
    expect(events.at(-1)).toEqual({ kind: "turn_failed", reason: "The turn was stopped." });
  });

  test("a refused prompt, a dead process and a failed start each end the turn once", async () => {
    const refused = new FakePi([
      { records: [{ type: "response", command: "prompt", success: false, error: "Agent is already processing." }] },
    ]);
    expect(await drain(engine(refused).runTurn(request()))).toEqual([
      { kind: "turn_failed", reason: "Agent is already processing." },
    ]);
    const dead = new FakePi([{ records: [{ type: "agent_start" }], stderr: "No API key for provider openai\n" }]);
    expect(await drain(engine(dead).runTurn(request()))).toEqual([
      { kind: "turn_failed", reason: "pi stopped before the turn ended. No API key for provider openai" },
    ]);
    const missing = new PiEngine({
      command: ["pi"],
      workFolder: join(folder, "pi"),
      models: { default: null, opus: null, sonnet: null, haiku: null },
      start: () => {
        throw new Error("pi is not installed");
      },
    });
    expect(await drain(missing.runTurn(request()))).toEqual([
      { kind: "turn_failed", reason: "pi could not start: pi is not installed" },
    ]);
  });

  test("continue runs on the same session file; a lost file says so first (lesson 46)", async () => {
    sessionFile("session-1", [
      { id: "u1", role: "user" },
      { id: "a1", role: "assistant" },
    ]);
    const fake = new FakePi([{ records: loadPiFixture("continue-same-process") }, { records: loadPiFixture("plain") }]);
    const kept = await drain(
      engine(fake).runTurn(request({ history: { kind: "continue", engineSessionId: "session-1" } })),
    );
    expect(kept[0]?.kind).toBe("text");
    expect(fake.runs[0]?.command).toContain(join(sessions, "session-1.jsonl"));
    const lost = await drain(engine(fake).runTurn(request({ history: { kind: "continue", engineSessionId: "gone" } })));
    expect(lost[0]).toEqual({ kind: "history_lost" });
  });

  test("a fork writes a branch file up to the chosen answer, and the turn runs on it", async () => {
    sessionFile("session-1", [
      { id: "u1", role: "user" },
      { id: "a1", role: "assistant" },
      { id: "u2", role: "user" },
      { id: "a2", role: "assistant" },
    ]);
    const fake = new FakePi([{ records: loadPiFixture("fork-manual-file") }]);
    const events = await drain(
      engine(fake).runTurn(request({ history: { kind: "fork", fromEngineSessionId: "session-1", atMessageId: "a1" } })),
    );
    const branch = readFileSync(join(sessions, "fork-1.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; id: string; parentSession?: string });
    expect(branch.map((entry) => entry.id).slice(1)).toEqual(["u1", "a1"]);
    expect(branch[0]?.type).toBe("session");
    expect(branch[0]?.parentSession).toBe(join(sessions, "session-1.jsonl"));
    expect(fake.runs[0]?.command).toContain(join(sessions, "fork-1.jsonl"));
    expect(events.at(-1)).toMatchObject({ kind: "turn_finished", engineSessionId: "fork-1" });
  });

  test("a fork from a lost answer says so, then runs as a new conversation", async () => {
    const fake = new FakePi([{ records: loadPiFixture("plain") }]);
    const events = await drain(
      engine(fake).runTurn(request({ history: { kind: "fork", fromEngineSessionId: "gone", atMessageId: "a1" } })),
    );
    expect(events[0]).toEqual({ kind: "history_lost" });
    expect(existsSync(join(sessions, "fork-1.jsonl"))).toBe(false);
  });
});
