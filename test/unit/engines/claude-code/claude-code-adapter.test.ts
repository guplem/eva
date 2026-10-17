/**
 * Contract tests for the Claude Code adapter on SDK messages captured from Claude Agent SDK
 * 0.3.300 and claude 2.1.286 against the demo vault (test/fixtures/claude-code/, made by
 * scripts/capture-claude-fixtures.ts).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  buildQueryOptions,
  ClaudeCodeEngine,
  mapSdkMessages,
} from "../../../../src/engines/claude-code/claude-code-adapter.ts";
import type { ApprovalAnswer, TurnRequest } from "../../../../src/shared/engine-port.ts";
import type { EngineEventPayload } from "../../../../src/shared/events.ts";

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

/** The error that the SDK threw after the captured messages, as the capture script records it. */
interface CapturedThrow {
  readonly type: "eva_capture_error";
  readonly message: string;
}
type CapturedLine = SDKMessage | CapturedThrow;

function loadCapture(name: string): CapturedLine[] {
  return readFileSync(join(import.meta.dir, "..", "..", "..", "fixtures", "claude-code", `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CapturedLine);
}

function isMessage(line: CapturedLine): line is SDKMessage {
  return line.type !== "eva_capture_error";
}

function resultOf(name: string): SDKMessage {
  const result = loadCapture(name)
    .filter(isMessage)
    .find((message) => message.type === "result");
  if (result === undefined) throw new Error(`The capture ${name} has no result.`);
  return result;
}

/** Plays captured lines back as the SDK sends them: each message in order, then the captured throw. */
async function* replay(lines: readonly CapturedLine[]): AsyncIterable<SDKMessage> {
  await Promise.resolve();
  for (const line of lines) {
    if (!isMessage(line)) throw new Error(line.message);
    yield line;
  }
}

async function drain(events: AsyncIterable<EngineEventPayload>): Promise<EngineEventPayload[]> {
  const all: EngineEventPayload[] = [];
  for await (const event of events) all.push(event);
  return all;
}

function collect(lines: readonly CapturedLine[]): Promise<EngineEventPayload[]> {
  return drain(mapSdkMessages(replay(lines)));
}

describe("buildQueryOptions", () => {
  test("Assistant mode: the Claude Code prompt plus Eva's text, no hooks, the vault plugin", () => {
    const options = buildQueryOptions(request(), "/bin/claude");
    expect(options).toMatchObject({
      cwd: "/demo-vault",
      pathToClaudeCodeExecutable: "/bin/claude",
      sessionId: "session-1",
      systemPrompt: { type: "preset", preset: "claude_code", append: "You are Eva.", excludeDynamicSections: true },
      settingSources: ["user", "project"],
      settings: { disableAllHooks: true },
      plugins: [{ type: "local", path: "/demo-vault/.eva" }],
      env: { PATH: "/bin" },
    });
    expect(options.model).toBeUndefined();
    expect(options.resume).toBeUndefined();
  });

  test("Project mode: the harness exactly as a manual session, with no Eva text", () => {
    const options = buildQueryOptions(
      request({ mode: "project", appendSystemPrompt: null, pluginFolders: [], startFolder: "/clone" }),
      "/bin/claude",
    );
    expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
    expect(options.settingSources).toEqual(["user", "project", "local"]);
    expect(options.settings).toBeUndefined();
    expect(options.plugins).toEqual([]);
    expect(options.permissionMode).toBeUndefined();
  });

  test("Project mode on an untrusted clone turns off its hooks, its settings and its project MCP servers", () => {
    const options = buildQueryOptions(
      request({ mode: "project", appendSystemPrompt: null, trusted: false }),
      "/bin/claude",
    );
    expect(options.settings).toEqual({ disableAllHooks: true });
    expect(options.strictMcpConfig).toBe(true);
    // The clone's own settings could allow every tool and skip the approval.
    expect(options.settingSources).toEqual(["user"]);
  });

  test("continue resumes the session; fork resumes at a message into a new session", () => {
    expect(buildQueryOptions(request({ history: { kind: "continue", engineSessionId: "s1" } }), "c")).toMatchObject({
      resume: "s1",
    });
    const fork = buildQueryOptions(
      request({ history: { kind: "fork", fromEngineSessionId: "s1", atMessageId: "m3" } }),
      "c",
    );
    expect(fork).toMatchObject({ resume: "s1", resumeSessionAt: "m3", forkSession: true });
    expect(fork.sessionId).toBeUndefined();
  });

  test("Eva's MCP servers become stdio servers with their own environment", () => {
    const options = buildQueryOptions(
      request({ mcpServers: { google: { command: "uvx", args: ["workspace-mcp==2.1.0"], environment: { A: "1" } } } }),
      "/bin/claude",
    );
    expect(options.mcpServers).toEqual({
      google: { type: "stdio", command: "uvx", args: ["workspace-mcp==2.1.0"], env: { A: "1" } },
    });
    expect(buildQueryOptions(request(), "/bin/claude")).not.toHaveProperty("mcpServers");
  });

  test("a model alias other than default is passed through", () => {
    expect(buildQueryOptions(request({ model: "haiku" }), "c").model).toBe("haiku");
  });
});

describe("mapSdkMessages", () => {
  test("a turn with a tool becomes tool, text and finish events", async () => {
    // The engine sends each content block, thinking included, as its own assistant message.
    expect(await collect(loadCapture("new-turn-with-tool"))).toEqual([
      {
        kind: "tool_started",
        toolUseId: "toolu_01NPDs4NS42mRQR6bQNg4M83",
        name: "Read",
        summary: "Read /demo-vault\\Methods\\Morning Routine.md",
      },
      { kind: "tool_finished", toolUseId: "toolu_01NPDs4NS42mRQR6bQNg4M83", isError: false },
      { kind: "text", text: "The first step is: **Drink water.**", messageId: "9b600d45-5cf5-4963-b739-36803a54eb85" },
      {
        kind: "turn_finished",
        engineSessionId: "23f67f49-0cd8-446e-bb55-73d761e7c1a3",
        lastMessageId: "9b600d45-5cf5-4963-b739-36803a54eb85",
        usage: { inputTokens: 18, outputTokens: 267, cacheReadTokens: 46_966, cacheWriteTokens: 3453 },
        costUsd: 0.013937600000000001,
      },
    ]);
  });

  test("an error result becomes one turn_failed with the engine's own errors", async () => {
    // The SDK throws after this result. The map stops at the result, so the throw adds no second turn end.
    expect(await collect(loadCapture("missing-session"))).toEqual([
      { kind: "turn_failed", reason: "No conversation found with session ID: 71ddf508-567d-4246-a030-be41cfcdb43e" },
    ]);
  });

  test("a subagent's work becomes task events, and its inner messages stay out of the conversation", async () => {
    const agentToolUseId = "toolu_01BECqHSvNztXpQRA8tYD8gk";
    const events = await collect(loadCapture("subagent-task"));
    expect(events.slice(0, -1)).toEqual([
      { kind: "tool_started", toolUseId: agentToolUseId, name: "Agent", summary: "Agent Read file and report title" },
      {
        kind: "task_changed",
        taskId: "af535f9743f2b5266",
        description: "Read file and report title",
        state: "running",
      },
      {
        kind: "task_changed",
        taskId: "af535f9743f2b5266",
        description:
          "The title of the document is **Morning Routine**. It appears as the main heading (H1) at the top of the file.",
        state: "done",
      },
      { kind: "tool_finished", toolUseId: agentToolUseId, isError: false },
      {
        kind: "text",
        text: "The title of the document is **Morning Routine**.",
        messageId: "23da7ae4-ae23-4ee9-83a9-1eecd4823018",
      },
    ]);
    expect(events.at(-1)).toMatchObject({
      kind: "turn_finished",
      engineSessionId: "2077aab6-56f1-451d-91b6-ad749aed93ec",
    });
  });

  test("a subagent that does not complete becomes a failed task", async () => {
    // The capture has no failed subagent: this is its captured notification with another status.
    const notification = loadCapture("subagent-task").find(
      (line) => line.type === "system" && "subtype" in line && line.subtype === "task_notification",
    );
    const failed = { ...(notification as object), status: "failed" } as unknown as SDKMessage;
    const events = await collect([failed, resultOf("subagent-task")]);
    expect(events.map((event) => event.kind)).toEqual(["task_changed", "turn_finished"]);
    expect(events[0]).toMatchObject({ taskId: "af535f9743f2b5266", state: "failed" });
  });

  test("text from inside a subagent stays out of the conversation", async () => {
    // The foreground capture has no inner text: this is the captured answer moved inside the subagent.
    const answer = loadCapture("subagent-task")
      .filter(isMessage)
      .findLast((message) => message.type === "assistant");
    const inner = { ...(answer as object), parent_tool_use_id: "toolu_01BECqHSvNztXpQRA8tYD8gk" } as SDKMessage;
    const events = await collect([inner, resultOf("subagent-task")]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "turn_finished", lastMessageId: null });
  });

  test("init, rate limit and thinking messages are ignored", async () => {
    const other = loadCapture("new-turn-with-tool").filter(
      (line) => line.type === "system" || line.type === "rate_limit_event",
    );
    expect(other.map((line) => line.type)).toContain("rate_limit_event");
    expect(await collect([...other, resultOf("new-turn-with-tool")])).toHaveLength(1);
  });
});

describe("ClaudeCodeEngine", () => {
  test("runs the query with the built options and maps its messages", async () => {
    const seen: unknown[] = [];
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      query: ({ prompt, options }) => {
        seen.push({ prompt, options });
        return replay(loadCapture("resumed-turn"));
      },
    });
    const events: EngineEventPayload[] = [];
    for await (const event of engine.runTurn(request())) events.push(event);
    expect(events.map((event) => event.kind)).toEqual(["text", "turn_finished"]);
    expect(seen[0]).toMatchObject({ prompt: "Hello", options: { cwd: "/demo-vault" } });
  });

  test("a thrown SDK error becomes one turn_failed", async () => {
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      query: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(new Error("Claude Code process exited with code 1")),
        }),
      }),
    });
    const events: EngineEventPayload[] = [];
    for await (const event of engine.runTurn(request())) events.push(event);
    expect(events).toEqual([{ kind: "turn_failed", reason: "Claude Code process exited with code 1" }]);
  });

  test("a resume of a session the engine lost starts again in a new session, once (lesson 46)", async () => {
    const calls: object[] = [];
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      newSessionId: () => "session-2",
      query: ({ options }) => {
        calls.push(options);
        return replay(loadCapture(calls.length === 1 ? "missing-session" : "new-turn-with-tool"));
      },
    });
    const events: EngineEventPayload[] = [];
    for await (const event of engine.runTurn(request({ history: { kind: "continue", engineSessionId: "s1" } })))
      events.push(event);
    expect(events.map((event) => event.kind)).toEqual([
      "history_lost",
      "tool_started",
      "tool_finished",
      "text",
      "turn_finished",
    ]);
    expect(calls[1]).toMatchObject({ sessionId: "session-2" });
    expect(calls[1]).not.toHaveProperty("resume");
  });

  test("Assistant mode asks for approval only for actions that reach other people", async () => {
    const asked: string[] = [];
    let canUseTool: ((name: string, input: Record<string, unknown>) => Promise<unknown>) | undefined;
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      query: ({ options }) => {
        canUseTool = (options as { canUseTool: typeof canUseTool }).canUseTool;
        return (async function* () {
          await Promise.resolve();
          yield resultOf("resumed-turn");
        })();
      },
    });
    const turnRequest = request({
      requestApproval: (approval) => {
        asked.push(`${approval.toolName}: ${approval.summary}`);
        return Promise.resolve("deny");
      },
    });
    await drain(engine.runTurn(turnRequest));
    expect(await canUseTool?.("Edit", { file_path: "Methods/A.md" })).toMatchObject({ behavior: "allow" });
    expect(await canUseTool?.("Bash", { command: "git status" })).toMatchObject({ behavior: "allow" });
    expect(await canUseTool?.("Bash", { command: "gh issue create --title x" })).toMatchObject({ behavior: "deny" });
    expect(await canUseTool?.("mcp__google__send_email", { to: "a@b.c" })).toMatchObject({ behavior: "deny" });
    expect(asked).toEqual(["Bash: gh issue create --title x", 'mcp__google__send_email: {"to":"a@b.c"}']);
  });

  test("Project mode sends every permission ask to the person", async () => {
    let canUseTool: ((name: string, input: Record<string, unknown>) => Promise<unknown>) | undefined;
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      query: ({ options }) => {
        canUseTool = (options as { canUseTool: typeof canUseTool }).canUseTool;
        return (async function* () {
          await Promise.resolve();
          yield resultOf("resumed-turn");
        })();
      },
    });
    await drain(engine.runTurn(request({ mode: "project", appendSystemPrompt: null })));
    expect(await canUseTool?.("Bash", { command: "git status" })).toMatchObject({ behavior: "allow" });
  });
});

type CanUseTool = (name: string, input: Record<string, unknown>) => Promise<{ behavior: string }>;

describe("the approval gate for Google writes", () => {
  async function decisions(inputs: Record<string, unknown>[]): Promise<string[]> {
    let canUseTool: CanUseTool | undefined;
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      query: ({ options }) => {
        canUseTool = (options as unknown as { canUseTool: CanUseTool }).canUseTool;
        return (async function* () {
          await Promise.resolve();
          yield resultOf("resumed-turn");
        })();
      },
    });
    await drain(engine.runTurn(request({ requestApproval: () => Promise.resolve("deny") })));
    const results: string[] = [];
    for (const input of inputs) results.push((await canUseTool?.("mcp__google__manage_event", input))?.behavior ?? "");
    return results;
  }

  test("an event in the person's own calendar needs no approval; guests, updates and RSVPs do", async () => {
    expect(
      await decisions([
        { action: "create", summary: "Dentist" },
        { action: "create", summary: "Lunch", attendees: ["friend@example.com"] },
        { action: "update", event_id: "1", attendees: "friend@example.com" },
        { action: "delete", event_id: "1", send_updates: "all" },
        { action: "rsvp", event_id: "1", response: "accepted" },
        { action: "update", event_id: "1", attendees: [] },
      ]),
    ).toEqual(["allow", "deny", "deny", "deny", "deny", "allow"]);
  });

  test("a calendar write with guests reaches the MCP server only after the person allows it", async () => {
    const folder = mkdtempSync(join(tmpdir(), "eva-mcp-"));
    const log = join(folder, "calls.jsonl");
    const google = {
      command: process.execPath,
      args: [join(import.meta.dir, "..", "..", "..", "support", "fake-google-mcp.ts")],
      environment: { FAKE_MCP_LOG: log },
    };
    const invite = { action: "create", summary: "Lunch", attendees: ["friend@example.com"] };
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      // A scripted model: it asks to write the event, then calls the server only when allowed.
      query: ({ options }) =>
        (async function* () {
          const canUseTool = (options as unknown as { canUseTool: CanUseTool }).canUseTool;
          const decision = await canUseTool("mcp__google__manage_event", invite);
          const server = options.mcpServers?.["google"] as {
            command: string;
            args: string[];
            env: Record<string, string>;
          };
          if (decision.behavior === "allow") await callTool(server, "manage_event", invite);
          yield resultOf("resumed-turn");
        })(),
    });
    try {
      await drain(engine.runTurn(request({ mcpServers: { google }, requestApproval: () => Promise.resolve("deny") })));
      expect(existsSync(log)).toBe(false);
      await drain(engine.runTurn(request({ mcpServers: { google }, requestApproval: () => Promise.resolve("allow") })));
      expect(
        readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as unknown),
      ).toEqual([{ name: "manage_event", arguments: invite }]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

/** Starts a stdio MCP server, initializes it, calls one tool, and waits for the answer. */
async function callTool(
  server: { command: string; args: string[]; env: Record<string, string> },
  name: string,
  input: Record<string, unknown>,
): Promise<void> {
  const child = Bun.spawn([server.command, ...server.args], {
    env: { ...process.env, ...server.env },
    stdin: "pipe",
    stdout: "pipe",
  });
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: input } },
  ];
  await child.stdin.write(messages.map((message) => JSON.stringify(message)).join("\n") + "\n");
  await child.stdin.flush();
  const reader = child.stdout.getReader();
  let output = "";
  while (!output.includes('"id":2')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    output += new TextDecoder().decode(chunk.value);
  }
  child.kill();
  await child.exited;
}
