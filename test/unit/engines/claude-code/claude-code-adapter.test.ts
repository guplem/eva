/**
 * The SDK messages below are built from the Claude Agent SDK 0.3.300 types, not captured
 * from a real run: no login was available when this adapter was written. Replace them with
 * a capture from scripts/capture-claude-fixtures.ts (docs/owner-todo.md).
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

const usage = { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 25_000, cache_creation_input_tokens: 300 };

const assistantWithTool = {
  type: "assistant",
  uuid: "msg-1",
  session_id: "session-1",
  parent_tool_use_id: null,
  message: {
    content: [
      { type: "text", text: "Let me read it." },
      { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "/demo-vault/Methods/Morning Routine.md" } },
    ],
  },
} as unknown as SDKMessage;
const toolResult = {
  type: "user",
  parent_tool_use_id: null,
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "tool-1", content: "1. Drink water.", is_error: false }],
  },
} as unknown as SDKMessage;
const assistantAnswer = {
  type: "assistant",
  uuid: "msg-2",
  session_id: "session-1",
  parent_tool_use_id: null,
  message: { content: [{ type: "text", text: "Drink water." }] },
} as unknown as SDKMessage;
const success = {
  type: "result",
  subtype: "success",
  is_error: false,
  session_id: "session-1",
  usage,
  total_cost_usd: 0.05,
  result: "Drink water.",
} as unknown as SDKMessage;

async function drain(events: AsyncIterable<EngineEventPayload>): Promise<EngineEventPayload[]> {
  const all: EngineEventPayload[] = [];
  for await (const event of events) all.push(event);
  return all;
}

async function collect(messages: SDKMessage[]): Promise<EngineEventPayload[]> {
  async function* source(): AsyncIterable<SDKMessage> {
    await Promise.resolve();
    yield* messages;
  }
  const events: EngineEventPayload[] = [];
  for await (const event of mapSdkMessages(source())) events.push(event);
  return events;
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
  test("a turn with a tool becomes text, tool and finish events", async () => {
    const events = await collect([assistantWithTool, toolResult, assistantAnswer, success]);
    expect(events).toEqual([
      { kind: "text", text: "Let me read it.", messageId: "msg-1" },
      {
        kind: "tool_started",
        toolUseId: "tool-1",
        name: "Read",
        summary: "Read /demo-vault/Methods/Morning Routine.md",
      },
      { kind: "tool_finished", toolUseId: "tool-1", isError: false },
      { kind: "text", text: "Drink water.", messageId: "msg-2" },
      {
        kind: "turn_finished",
        engineSessionId: "session-1",
        lastMessageId: "msg-2",
        usage: { inputTokens: 12, outputTokens: 7, cacheReadTokens: 25_000, cacheWriteTokens: 300 },
        costUsd: 0.05,
      },
    ]);
  });

  test("an error result becomes turn_failed with the engine's own errors", async () => {
    const failure = {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      session_id: "s",
      usage,
      total_cost_usd: 0,
      errors: ["Tool crashed"],
    } as unknown as SDKMessage;
    expect(await collect([failure])).toEqual([{ kind: "turn_failed", reason: "Tool crashed" }]);
  });

  test("a subagent's work becomes task events", async () => {
    const started = {
      type: "system",
      subtype: "task_started",
      task_id: "t1",
      description: "Search the notes",
    } as unknown as SDKMessage;
    const ended = {
      type: "system",
      subtype: "task_notification",
      task_id: "t1",
      status: "completed",
      summary: "done",
      output_file: "x",
    } as unknown as SDKMessage;
    const failed = {
      type: "system",
      subtype: "task_notification",
      task_id: "t2",
      status: "failed",
      summary: "broke",
      output_file: "x",
    } as unknown as SDKMessage;
    const events = await collect([started, ended, failed, success]);
    expect(events.slice(0, 3)).toEqual([
      { kind: "task_changed", taskId: "t1", description: "Search the notes", state: "running" },
      { kind: "task_changed", taskId: "t1", description: "done", state: "done" },
      { kind: "task_changed", taskId: "t2", description: "broke", state: "failed" },
    ]);
    expect(events[3]?.kind).toBe("turn_finished");
  });

  test("text from inside a subagent stays out of the conversation", async () => {
    const inner = { ...(assistantAnswer as object), parent_tool_use_id: "tool-9" } as unknown as SDKMessage;
    const events = await collect([inner, success]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "turn_finished", lastMessageId: null });
  });

  test("other message kinds are ignored", async () => {
    const init = { type: "system", subtype: "init", cwd: "/demo-vault" } as unknown as SDKMessage;
    expect(await collect([init, success])).toHaveLength(1);
  });
});

describe("ClaudeCodeEngine", () => {
  test("runs the query with the built options and maps its messages", async () => {
    const seen: unknown[] = [];
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      query: ({ prompt, options }) => {
        seen.push({ prompt, options });
        return (async function* () {
          await Promise.resolve();
          yield assistantAnswer;
          yield success;
        })();
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
        if (calls.length === 1) {
          const lost = {
            type: "result",
            subtype: "error_during_execution",
            is_error: true,
            session_id: "s",
            usage,
            total_cost_usd: 0,
            errors: ["No conversation found with session ID: s1"],
          } as unknown as SDKMessage;
          return (async function* () {
            await Promise.resolve();
            yield lost;
          })();
        }
        return (async function* () {
          await Promise.resolve();
          yield { ...(assistantAnswer as object), session_id: "session-2" } as unknown as SDKMessage;
          yield { ...(success as object), session_id: "session-2" } as unknown as SDKMessage;
        })();
      },
    });
    const events: EngineEventPayload[] = [];
    for await (const event of engine.runTurn(request({ history: { kind: "continue", engineSessionId: "s1" } })))
      events.push(event);
    expect(events.map((event) => event.kind)).toEqual(["history_lost", "text", "turn_finished"]);
    expect(calls[1]).toMatchObject({ sessionId: "session-2" });
    expect(calls[1]).not.toHaveProperty("resume");
  });

  test("Assistant mode asks for approval only for actions that reach other people (plan §5.5)", async () => {
    const asked: string[] = [];
    let canUseTool: ((name: string, input: Record<string, unknown>) => Promise<unknown>) | undefined;
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      query: ({ options }) => {
        canUseTool = (options as { canUseTool: typeof canUseTool }).canUseTool;
        return (async function* () {
          await Promise.resolve();
          yield success;
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
          yield success;
        })();
      },
    });
    await drain(engine.runTurn(request({ mode: "project", appendSystemPrompt: null })));
    expect(await canUseTool?.("Bash", { command: "git status" })).toMatchObject({ behavior: "allow" });
  });
});

type CanUseTool = (name: string, input: Record<string, unknown>) => Promise<{ behavior: string }>;

describe("the approval gate for Google writes (plan §5.5, §9)", () => {
  async function decisions(inputs: Record<string, unknown>[]): Promise<string[]> {
    let canUseTool: CanUseTool | undefined;
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      query: ({ options }) => {
        canUseTool = (options as unknown as { canUseTool: CanUseTool }).canUseTool;
        return (async function* () {
          await Promise.resolve();
          yield success;
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
          yield success;
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
