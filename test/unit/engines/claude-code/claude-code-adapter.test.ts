/**
 * Contract tests for the Claude Code adapter on SDK messages captured from Claude Agent SDK
 * 0.3.300 and claude 2.1.286 against the demo vault (test/fixtures/claude-code/, made by
 * scripts/capture-claude-fixtures.ts). The background-subagent capture comes from claude 2.1.302,
 * and the streamed-answer capture from claude 2.1.310.
 */
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import type { McpServerStatus, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  buildQueryOptions,
  ClaudeCodeEngine,
  hiddenInstructionPatterns,
  mapSdkMessages,
} from "../../../../src/engines/claude-code/claude-code-adapter.ts";
import type { ApprovalAnswer, QuestionsOutcome, TurnRequest } from "../../../../src/shared/engine-port.ts";
import { isTurnEnd, type EngineEventPayload } from "../../../../src/shared/events.ts";

function request(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    mode: "assistant",
    history: { kind: "new", engineSessionId: "session-1" },
    startFolder: "/demo-vault",
    projectFolder: null,
    prompt: "Hello",
    model: "opus",
    effort: null,
    appendSystemPrompt: "You are Eva.",
    pluginFolders: ["/demo-vault/.eva"],
    mcpServers: {},
    trusted: true,
    environment: { PATH: "/bin" },
    requestApproval: () => Promise.resolve<ApprovalAnswer>("allow"),
    askQuestions: () => Promise.resolve<QuestionsOutcome>("declined"),
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
  test("Assistant mode: Eva's text replaces the Claude Code prompt, no hooks, the vault plugin", () => {
    const options = buildQueryOptions(request(), "/bin/claude");
    expect(options).toMatchObject({
      cwd: "/demo-vault",
      pathToClaudeCodeExecutable: "/bin/claude",
      sessionId: "session-1",
      systemPrompt: "You are Eva.",
      settingSources: ["user", "project"],
      settings: { disableAllHooks: true },
      plugins: [{ type: "local", path: "/demo-vault/.eva" }],
      env: { PATH: "/bin" },
    });
    expect(options.model).toBe("opus");
    expect(options.resume).toBeUndefined();
  });

  test("Assistant mode: Eva's ask rules beat a person's own allow rules and auto mode (issues #51, #428)", () => {
    const server = { command: "uvx", args: [], environment: {} };
    const options = buildQueryOptions(request({ mcpServers: { google: server } }), "/bin/claude");
    // An "ask" rule wins over any "allow" rule, so every such call reaches canUseTool and Eva's approval.
    expect(options.settings).toEqual({
      disableAllHooks: true,
      autoMemoryEnabled: false,
      permissions: { ask: ["Bash", "Edit(./.eva/**)", "mcp__google"] },
    });
  });

  test("Assistant mode: Claude Code's auto-memory is off, so a fact lands in the vault (issue #68)", () => {
    const options = buildQueryOptions(request(), "/bin/claude");
    // The memory folder is on one machine, outside git: no other machine would see the fact.
    expect(options.settings).toMatchObject({ autoMemoryEnabled: false });
  });

  test("Project mode: the harness's own prompt and setting sources, with no Eva text", () => {
    const options = buildQueryOptions(
      request({ mode: "project", appendSystemPrompt: null, pluginFolders: [], startFolder: "/clone" }),
      "/bin/claude",
    );
    expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
    expect(options.settingSources).toEqual(["user", "project", "local"]);
    expect(options.settings).toBeUndefined();
    expect(options.plugins).toEqual([]);
  });

  test("Project mode hides each instruction file above the project folder, such as the vault's map (#702)", () => {
    const options = buildQueryOptions(
      request({
        mode: "project",
        appendSystemPrompt: null,
        pluginFolders: [],
        startFolder: "/vault/Projects/2026-01-01-0000-example-app/repos/clone-0",
        projectFolder: "/vault/Projects/2026-01-01-0000-example-app",
      }),
      "/bin/claude",
    );
    const names = ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md", "AGENTS.md", ".claude/AGENTS.md"];
    const filesOf = (folder: string): string[] => [
      ...names.map((name) => `${folder}/${name}`),
      `${folder}/.claude/rules/**`,
    ];
    expect(options.settings).toEqual({
      claudeMdExcludes: [...filesOf("/vault/Projects"), ...filesOf("/vault"), ...filesOf("")],
    });
    // The project's own files and the person's user-level CLAUDE.md stay loaded.
    expect(options.settingSources).toEqual(["user", "project", "local"]);
  });

  test("a glob character in a folder name becomes `?`, because Claude Code turns a backslash into a slash", () => {
    const patterns = hiddenInstructionPatterns("/home/a (b)/[c]/{d}*?!+@/vault/Projects/example-app", posix);
    expect(patterns).toContain("/home/a ?b?/?c?/?d??????/vault/AGENTS.md");
    expect(patterns.some((pattern) => pattern.includes("example-app"))).toBe(false);
  });

  test("a Windows folder gives slashes and any drive letter, since picomatch matches case", () => {
    const patterns = hiddenInstructionPatterns("C:\\Users\\Example\\vault\\Projects\\example-app", win32);
    expect(patterns).toContain("?:/Users/Example/vault/AGENTS.md");
    expect(patterns).toContain("?:/AGENTS.md");
    expect(patterns.every((pattern) => !pattern.includes("\\"))).toBe(true);
  });

  test("a project folder behind a link also hides the files above its real path", () => {
    const root = mkdtempSync(join(tmpdir(), "eva-real-"));
    try {
      const real = join(root, "real", "Projects", "example-app");
      mkdirSync(real, { recursive: true });
      // A junction needs no admin rights on Windows.
      symlinkSync(join(root, "real"), join(root, "link"), process.platform === "win32" ? "junction" : "dir");
      const patterns = hiddenInstructionPatterns(join(root, "link", "Projects", "example-app"));
      const asPattern = (folder: string): string => folder.replaceAll("\\", "/").replace(/^[A-Za-z]:/, "?:");
      expect(patterns).toContain(`${asPattern(join(root, "link"))}/AGENTS.md`);
      expect(patterns).toContain(`${asPattern(realpathSync(join(root, "real")))}/AGENTS.md`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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

  test("Project mode on an untrusted clone still reads its instruction files, outermost first (issue #535)", () => {
    const root = mkdtempSync(join(tmpdir(), "eva-instructions-"));
    try {
      const clone = join(root, "Projects", "2026-01-01-0000-example-app", "repos", "example-app-1");
      mkdirSync(clone, { recursive: true });
      writeFileSync(join(root, "Projects", "2026-01-01-0000-example-app", "AGENTS.md"), "Project rule.");
      writeFileSync(join(clone, "AGENTS.md"), "Clone rule.");
      const options = buildQueryOptions(
        request({ mode: "project", appendSystemPrompt: null, trusted: false, startFolder: clone }),
        "/bin/claude",
      );
      const systemPrompt = options.systemPrompt as { type: string; preset: string; append: string };
      expect(systemPrompt).toMatchObject({ type: "preset", preset: "claude_code" });
      expect(systemPrompt.append.indexOf("Project rule.")).toBeGreaterThan(-1);
      expect(systemPrompt.append.indexOf("Clone rule.")).toBeGreaterThan(systemPrompt.append.indexOf("Project rule."));
      expect(systemPrompt.append).toContain(join(clone, "AGENTS.md"));
      expect(options.settingSources).toEqual(["user"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an untrusted clone reads no instruction file above its project folder (#702)", () => {
    const root = mkdtempSync(join(tmpdir(), "eva-instructions-"));
    try {
      const projectFolder = join(root, "Projects", "2026-01-01-0000-example-app");
      const clone = join(projectFolder, "repos", "clone-0");
      mkdirSync(clone, { recursive: true });
      writeFileSync(join(root, "AGENTS.md"), "Vault map.");
      writeFileSync(join(root, "CLAUDE.md"), "Vault Claude rule.");
      writeFileSync(join(projectFolder, "AGENTS.md"), "Project rule.");
      const options = buildQueryOptions(
        request({ mode: "project", appendSystemPrompt: null, trusted: false, startFolder: clone, projectFolder }),
        "/bin/claude",
      );
      const { append } = options.systemPrompt as { append: string };
      expect(append).toContain("Project rule.");
      // A hidden CLAUDE.md above no longer hides the project's AGENTS.md, as Claude Code's exclusion does.
      expect(append).not.toContain("Vault map.");
      expect(append).not.toContain("Vault Claude rule.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an untrusted clone's AGENTS.md is skipped when a CLAUDE.md exists, as Claude Code does", () => {
    const root = mkdtempSync(join(tmpdir(), "eva-instructions-"));
    try {
      const clone = join(root, "repos", "example-app-1");
      mkdirSync(join(clone, ".claude"), { recursive: true });
      writeFileSync(join(root, "CLAUDE.md"), "Outer Claude rule.");
      writeFileSync(join(clone, ".claude", "CLAUDE.md"), "Inner Claude rule.");
      writeFileSync(join(clone, "AGENTS.md"), "Clone rule.");
      const options = buildQueryOptions(
        request({ mode: "project", appendSystemPrompt: null, trusted: false, startFolder: clone }),
        "/bin/claude",
      );
      const { append } = options.systemPrompt as { append: string };
      expect(append).toContain("Outer Claude rule.");
      expect(append).toContain("Inner Claude rule.");
      expect(append).not.toContain("Clone rule.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an untrusted clone with no instruction file gets the plain Claude Code prompt", () => {
    const root = mkdtempSync(join(tmpdir(), "eva-instructions-"));
    try {
      const options = buildQueryOptions(
        request({ mode: "project", appendSystemPrompt: null, trusted: false, startFolder: root }),
        "/bin/claude",
      );
      expect(options.systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("A model call: the caller's prompt alone, with no tools, no settings and no saved session", () => {
    const options = buildQueryOptions(
      request({ mode: "model-call", appendSystemPrompt: "Name chats.", pluginFolders: [], trusted: false }),
      "/bin/claude",
    );
    expect(options).toMatchObject({
      systemPrompt: "Name chats.",
      tools: [],
      settingSources: [],
      persistSession: false,
      strictMcpConfig: true,
      settings: { disableAllHooks: true, autoMemoryEnabled: false },
    });
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

  test("each tier goes to Claude Code as its alias, so Claude Code runs the newest model of it (#550)", () => {
    expect(buildQueryOptions(request({ model: "haiku" }), "c").model).toBe("haiku");
  });

  test("the chat's effort goes to Claude Code, and no effort keeps Claude Code's own (#419, #550)", () => {
    expect(buildQueryOptions(request(), "c")).not.toHaveProperty("effort");
    expect(buildQueryOptions(request({ effort: "xhigh" }), "c").effort).toBe("xhigh");
  });

  test("Assistant and Project mode stream the text; a model call has no front end to stream to (issue 117)", () => {
    expect(buildQueryOptions(request(), "c").includePartialMessages).toBe(true);
    expect(buildQueryOptions(request({ mode: "project", appendSystemPrompt: null }), "c").includePartialMessages).toBe(
      true,
    );
    expect(buildQueryOptions(request({ mode: "model-call" }), "c").includePartialMessages).toBeUndefined();
  });

  test("Assistant and Project chats start in auto mode by default", () => {
    expect(buildQueryOptions(request(), "c").permissionMode).toBe("auto");
    const project = buildQueryOptions(request({ mode: "project", appendSystemPrompt: null }), "c");
    expect(project.permissionMode).toBe("auto");
    expect(project.allowDangerouslySkipPermissions).toBeUndefined();
  });

  test("the bypass setting skips every permission check in Assistant and trusted Project chats", () => {
    for (const mode of ["assistant", "project"] as const) {
      const options = buildQueryOptions(request({ mode }), "c", "bypassPermissions");
      expect(options).toMatchObject({ permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true });
    }
  });

  test("an untrusted clone stays in auto mode, even with the bypass setting", () => {
    const options = buildQueryOptions(request({ mode: "project", trusted: false }), "c", "bypassPermissions");
    expect(options.permissionMode).toBe("auto");
    expect(options.allowDangerouslySkipPermissions).toBeUndefined();
  });

  test("a model call gets no permission mode: it has no tools", () => {
    const options = buildQueryOptions(request({ mode: "model-call" }), "c", "bypassPermissions");
    expect(options.permissionMode).toBeUndefined();
    expect(options.allowDangerouslySkipPermissions).toBeUndefined();
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
        category: "tool",
        summary: "Read /demo-vault\\Methods\\Morning Routine.md",
        input: JSON.stringify({ file_path: "/demo-vault\\Methods\\Morning Routine.md" }, null, 2),
      },
      {
        kind: "tool_finished",
        toolUseId: "toolu_01NPDs4NS42mRQR6bQNg4M83",
        isError: false,
        output: "1\t# Morning Routine\n2\t\n3\t1. Drink water.\n4\t2. Stretch.\n5\t",
      },
      { kind: "text", text: "The first step is: **Drink water.**", messageId: "9b600d45-5cf5-4963-b739-36803a54eb85" },
      {
        kind: "turn_finished",
        engineSessionId: "23f67f49-0cd8-446e-bb55-73d761e7c1a3",
        lastMessageId: "9b600d45-5cf5-4963-b739-36803a54eb85",
        usage: { inputTokens: 18, outputTokens: 267, cacheReadTokens: 46_966, cacheWriteTokens: 3453 },
        costUsd: 0.013937600000000001,
        // The context of the last call (8 + 25,062 + 295), not the sum over the turn's two calls.
        contextTokens: 25_365,
        contextWindow: 200_000,
        model: "claude-haiku-4-5-20251001",
      },
    ]);
  });

  test("a synthetic message with no usage keeps the context of the last real call", async () => {
    const lines = loadCapture("new-turn-with-tool");
    const lastAssistant = lines.findLast((line) => line.type === "assistant")!;
    const usage = { ...lastAssistant.message.usage, input_tokens: 0, cache_read_input_tokens: 0 };
    lines.splice(lines.indexOf(lastAssistant) + 1, 0, {
      ...lastAssistant,
      uuid: "00000000-0000-0000-0000-000000000000",
      message: { ...lastAssistant.message, content: [], usage: { ...usage, cache_creation_input_tokens: 0 } },
    });
    expect((await collect(lines)).at(-1)).toMatchObject({ kind: "turn_finished", contextTokens: 25_365 });
  });

  test("a turn with no usage at all has no context", async () => {
    const events = await collect([resultOf("new-turn-with-tool")]);
    expect(events.at(-1)).toMatchObject({ kind: "turn_finished", contextTokens: null });
  });

  test("the context window is the one of the model that answered, not of a helper model", async () => {
    const lines = loadCapture("new-turn-with-tool").filter(isMessage);
    const result = lines.find((line) => line.type === "result")!;
    const main = result.modelUsage["claude-haiku-4-5-20251001"]!;
    lines.splice(lines.indexOf(result), 1, {
      ...result,
      modelUsage: { "claude-helper": { ...main, contextWindow: 50_000 }, "claude-haiku-4-5-20251001": main },
    });
    expect((await collect(lines)).at(-1)).toMatchObject({ kind: "turn_finished", contextWindow: 200_000 });
  });

  test("a synthetic message with no usage keeps the model of the last real call", async () => {
    const lines = loadCapture("new-turn-with-tool").filter(isMessage);
    const lastAssistant = lines.findLast((line) => line.type === "assistant")!;
    const result = lines.find((line) => line.type === "result")!;
    const main = result.modelUsage["claude-haiku-4-5-20251001"]!;
    const noUsage = { ...lastAssistant.message.usage, input_tokens: 0, cache_read_input_tokens: 0 };
    lines.splice(lines.indexOf(lastAssistant) + 1, 0, {
      ...lastAssistant,
      uuid: "00000000-0000-0000-0000-000000000000",
      message: {
        ...lastAssistant.message,
        model: "<synthetic>",
        content: [],
        usage: { ...noUsage, cache_creation_input_tokens: 0 },
      },
    });
    lines.splice(lines.indexOf(result), 1, {
      ...result,
      modelUsage: { "claude-helper": { ...main, contextWindow: 50_000 }, "claude-haiku-4-5-20251001": main },
    });
    expect((await collect(lines)).at(-1)).toMatchObject({
      kind: "turn_finished",
      contextWindow: 200_000,
      model: "claude-haiku-4-5-20251001",
    });
  });

  test("a turn whose model the usage does not name has no context window, so Eva guesses no limit", async () => {
    const result = resultOf("new-turn-with-tool");
    if (result.type !== "result") throw new Error("The capture has no result.");
    const main = result.modelUsage["claude-haiku-4-5-20251001"]!;
    const two = { ...result, modelUsage: { a: main, b: { ...main, contextWindow: 50_000 } } };
    expect((await collect([two])).at(-1)).toMatchObject({ kind: "turn_finished", contextWindow: null });
    // With one model only, that model answered.
    const one = { ...result, modelUsage: { a: main } };
    expect((await collect([one])).at(-1)).toMatchObject({ kind: "turn_finished", contextWindow: 200_000 });
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
      {
        kind: "tool_started",
        toolUseId: agentToolUseId,
        name: "Agent",
        category: "tool",
        summary: "Agent Read file and report title",
        input: expect.any(String) as string,
      },
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
      { kind: "tool_finished", toolUseId: agentToolUseId, isError: false, output: expect.any(String) as string },
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

  test("a background subagent keeps the turn open until its follow-up answer, with one end (issue #70)", async () => {
    // The engine sends a result, then the subagent's work, then a second turn with its own result.
    const agentToolUseId = "toolu_01VWSzFjZEZ8CBgmiDqcysZk";
    expect(await collect(loadCapture("background-subagent"))).toEqual([
      // The capture's account was near its overage limit.
      {
        kind: "usage_limit",
        status: "warning",
        window: "overage",
        usedPercent: 99,
        resetsAt: "2026-11-01T00:00:00.000Z",
      },
      {
        kind: "tool_started",
        toolUseId: agentToolUseId,
        name: "Agent",
        category: "tool",
        summary: "Agent Read morning routine title",
        input: expect.any(String) as string,
      },
      {
        kind: "task_changed",
        taskId: "a28189aab45e77534",
        description: "Read morning routine title",
        state: "running",
      },
      { kind: "tool_finished", toolUseId: agentToolUseId, isError: false, output: expect.any(String) as string },
      {
        kind: "text",
        text: "I started a background subagent to read `Methods/Morning Routine.md` and report its title; I'll share the result when it arrives.",
        messageId: "d8c9c165-1864-42c0-888d-100fc1f7e696",
      },
      { kind: "task_changed", taskId: "a28189aab45e77534", description: "Morning Routine", state: "done" },
      {
        kind: "text",
        text: "The subagent reports the title of `Methods/Morning Routine.md` as **Morning Routine**.",
        messageId: "dc39ab4d-cb27-4c7b-92a8-e549da7b8e4d",
      },
      {
        kind: "turn_finished",
        engineSessionId: "46a21574-ea52-4c3e-aef8-94fd72c6ca82",
        lastMessageId: "dc39ab4d-cb27-4c7b-92a8-e549da7b8e4d",
        // Each result counts only its own turn, so the end sums them.
        usage: { inputTokens: 8, outputTokens: 321, cacheReadTokens: 47_693, cacheWriteTokens: 7141 },
        // The cost is a running total, so the last result holds the whole turn.
        costUsd: 0.003285575,
        contextTokens: 18_853,
        contextWindow: 1_000_000,
        model: "claude-haiku-5-5",
      },
    ]);
  });

  test("a stop while a background subagent works fails the turn, so the person sees it stopped", async () => {
    // The abort makes the SDK throw after the first result. The engine turns the throw into turn_failed.
    const lines = loadCapture("background-subagent");
    const firstResult = lines.findIndex((line) => line.type === "result");
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      query: () =>
        replay([...lines.slice(0, firstResult + 1), { type: "eva_capture_error", message: "Operation aborted" }]),
    });
    const events = await drain(engine.runTurn(request()));
    expect(events.filter(isTurnEnd)).toEqual([{ kind: "turn_failed", reason: "Operation aborted" }]);
  });

  test("an error result after a success result is the one turn end", async () => {
    const lines = [...loadCapture("new-turn-with-tool"), ...loadCapture("missing-session")];
    const events = await collect(lines);
    expect(events.filter(isTurnEnd).map((event) => event.kind)).toEqual(["turn_failed"]);
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

  test("a Bash tool call is a command", async () => {
    // The captures run no shell: this is the captured Read call renamed to Bash.
    const read = loadCapture("new-turn-with-tool")
      .filter(isMessage)
      .find(
        (message) => message.type === "assistant" && message.message.content.some((block) => block.type === "tool_use"),
      ) as Extract<SDKMessage, { type: "assistant" }>;
    const bash = {
      ...read,
      message: {
        ...read.message,
        content: read.message.content.map((block) =>
          block.type === "tool_use" ? { ...block, name: "Bash", input: { command: "ls" } } : block,
        ),
      },
    } as SDKMessage;
    const events = await collect([bash, resultOf("new-turn-with-tool")]);
    expect(events[0]).toMatchObject({ kind: "tool_started", name: "Bash", category: "command", summary: "ls" });
  });

  test("each streamed piece of the main text becomes a text_delta, before the whole text", async () => {
    const events = await collect(loadCapture("streamed-answer"));
    expect(events.slice(8).map((event) => event.kind)).toEqual(["text", "turn_finished"]);
    expect(events.slice(0, 8)).toEqual([
      { kind: "text_delta", text: "W", startsBlock: true },
      { kind: "text_delta", text: "ake" },
      { kind: "text_delta", text: " up on" },
      { kind: "text_delta", text: " time, dr" },
      { kind: "text_delta", text: "ink a gl" },
      { kind: "text_delta", text: "ass of water, and get" },
      { kind: "text_delta", text: " some s" },
      { kind: "text_delta", text: "unlight." },
    ]);
  });

  /** The captured stream line of this event type, with its event and parent changed. */
  function streamLine(type: string, event: object = {}, parentToolUseId: string | null = null): SDKMessage {
    const line = loadCapture("streamed-answer").find(
      (captured) => captured.type === "stream_event" && captured.event.type === type,
    );
    if (line === undefined) throw new Error(`The capture has no ${type} stream event.`);
    const captured = line as SDKMessage & { event: object };
    return { ...captured, event: { ...captured.event, ...event }, parent_tool_use_id: parentToolUseId } as SDKMessage;
  }

  test("thinking, empty pieces and a subagent's text stay out; a block that starts again is marked", async () => {
    // The capture has none of these cases: they are its stream lines with another event or parent.
    const piece = (text: string): object => ({ delta: { type: "text_delta", text } });
    const lines = [
      streamLine("message_start"),
      streamLine("content_block_delta", { delta: { type: "thinking_delta", thinking: "hmm" } }),
      streamLine("content_block_start", { index: 1 }),
      streamLine("content_block_delta", { index: 1, ...piece("") }),
      streamLine("content_block_delta", { index: 1, ...piece("The first ") }),
      streamLine("content_block_delta", { index: 1, ...piece("step") }),
      streamLine("content_block_start", {}, "toolu_1"),
      streamLine("content_block_delta", piece("inner"), "toolu_1"),
      // A model call that runs again starts its text block again.
      streamLine("content_block_start"),
      streamLine("content_block_delta", piece("The first ")),
      resultOf("new-turn-with-tool"),
    ];
    const events = await collect(lines);
    expect(events.filter((event) => event.kind === "text_delta")).toEqual([
      { kind: "text_delta", text: "The first ", startsBlock: true },
      { kind: "text_delta", text: "step" },
      { kind: "text_delta", text: "The first ", startsBlock: true },
    ]);
    expect(events).toHaveLength(4);
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

  test("init, thinking and plain allowed rate limit messages are ignored", async () => {
    const other = loadCapture("new-turn-with-tool").filter(
      (line) => line.type === "system" || line.type === "rate_limit_event",
    );
    expect(other.map((line) => line.type)).toContain("rate_limit_event");
    expect(await collect([...other, resultOf("new-turn-with-tool")])).toHaveLength(1);
  });

  /** The captured rate limit message, with the state of a window near or past its limit. */
  function rateLimitLine(info: Record<string, unknown>): SDKMessage {
    const captured = loadCapture("new-turn-with-tool").find((line) => line.type === "rate_limit_event")!;
    return { ...captured, rate_limit_info: { ...captured.rate_limit_info, ...info } };
  }

  test("a window near its limit becomes a usage warning with a whole percent and an ISO reset time", async () => {
    const warning = rateLimitLine({ status: "allowed_warning", utilization: 0.856 });
    expect(await collect([warning])).toEqual([
      {
        kind: "usage_limit",
        status: "warning",
        window: "five_hour",
        usedPercent: 86,
        resetsAt: "2026-10-18T00:50:00.000Z",
      },
    ]);
  });

  test("a refused turn becomes a usage refusal for its window", async () => {
    const rejected = rateLimitLine({ status: "rejected", rateLimitType: "seven_day", utilization: 1 });
    expect(await collect([rejected])).toEqual([
      {
        kind: "usage_limit",
        status: "rejected",
        window: "seven_day",
        usedPercent: 100,
        resetsAt: "2026-10-18T00:50:00.000Z",
      },
    ]);
  });

  test("the weekly window that includes extra usage is the weekly window", async () => {
    const weekly = rateLimitLine({ status: "rejected", rateLimitType: "seven_day_overage_included" });
    expect(await collect([weekly])).toMatchObject([{ kind: "usage_limit", window: "seven_day" }]);
  });

  test("a number that is not finite gives null, never a crash", async () => {
    const bad = rateLimitLine({
      status: "allowed_warning",
      utilization: Number.NaN,
      resetsAt: Number.POSITIVE_INFINITY,
    });
    expect(await collect([bad])).toEqual([
      { kind: "usage_limit", status: "warning", window: "five_hour", usedPercent: null, resetsAt: null },
    ]);
  });

  test("a missing or unknown field gives null or other, never a crash", async () => {
    const bare = rateLimitLine({
      status: "rejected",
      rateLimitType: "a_new_window",
      utilization: undefined,
      resetsAt: undefined,
    });
    expect(await collect([bare])).toEqual([
      { kind: "usage_limit", status: "rejected", window: "other", usedPercent: null, resetsAt: null },
    ]);
  });

  /** A refused turn as Claude Code ends it: its own line in UTC, an error result, then the SDK's throw. */
  function refusedTurn(): CapturedLine[] {
    const lines = loadCapture("new-turn-with-tool").filter(isMessage);
    const assistant = lines.find((line) => line.type === "assistant")!;
    const result = resultOf("new-turn-with-tool");
    const engineLine = "You've hit your session limit · resets 6:50pm (UTC)";
    return [
      rateLimitLine({ status: "rejected", utilization: 1 }),
      {
        ...assistant,
        message: { ...assistant.message, model: "<synthetic>", content: [{ type: "text", text: engineLine }] },
      } as SDKMessage,
      { ...result, is_error: true, result: engineLine } as SDKMessage,
      { type: "eva_capture_error", message: `Claude Code returned an error result: ${engineLine}` },
    ];
  }

  test("a refused turn shows Eva's line only, never the engine's line with its UTC time", async () => {
    const events = await drain(
      new ClaudeCodeEngine({ executable: "/bin/claude", query: () => replay(refusedTurn()) }).runTurn(request()),
    );
    expect(events).toMatchObject([
      { kind: "usage_limit", status: "rejected" },
      { kind: "turn_failed", reason: "Claude Code refused the turn at the usage limit." },
    ]);
    expect(events).toHaveLength(2);
  });
});

describe("an expired login", () => {
  /** A turn as Claude Code ends it when its token no longer works: its own line, an error result, then the SDK's throw. */
  function expiredTurn(): CapturedLine[] {
    const lines = loadCapture("new-turn-with-tool").filter(isMessage);
    const assistant = lines.find((line) => line.type === "assistant")!;
    const result = resultOf("new-turn-with-tool");
    const engineLine = "Invalid API key · Please run /login";
    return [
      {
        ...assistant,
        error: "authentication_failed",
        message: { ...assistant.message, model: "<synthetic>", content: [{ type: "text", text: engineLine }] },
      } as SDKMessage,
      { ...result, is_error: true, result: engineLine } as SDKMessage,
      { type: "eva_capture_error", message: `Claude Code returned an error result: ${engineLine}` },
    ];
  }

  test("fails the turn with the login flag and Eva's line, never the engine's line with its terminal fix", async () => {
    const events = await drain(
      new ClaudeCodeEngine({ executable: "/bin/claude", query: () => replay(expiredTurn()) }).runTurn(request()),
    );
    expect(events).toEqual([
      {
        kind: "turn_failed",
        reason: "The Claude Code login expired. Log in again in Settings, AI engines, Claude Code.",
        loginExpired: true,
      },
    ]);
  });

  test("an error of a subagent's message is not the turn's login", async () => {
    const lines = expiredTurn();
    const [assistant] = lines as [Extract<SDKMessage, { type: "assistant" }>];
    lines[0] = { ...assistant, parent_tool_use_id: "tool-1" };
    const events = await collect(lines.slice(0, 2));
    expect(events.some((event) => event.kind === "turn_failed" && event.loginExpired === true)).toBe(false);
  });
});

describe("the start of Eva's MCP servers", () => {
  /** The captured init message, with the given server states. */
  function initLine(servers: { name: string; status: string }[]): SDKMessage {
    const captured = loadCapture("new-turn-with-tool").find(
      (line) => line.type === "system" && line.subtype === "init",
    )!;
    return { ...captured, mcp_servers: servers };
  }

  function mapped(
    servers: { name: string; status: string }[],
    status: () => Promise<McpServerStatus[]>,
  ): Promise<EngineEventPayload[]> {
    return drain(
      mapSdkMessages(replay([initLine(servers), resultOf("new-turn-with-tool")]), {
        servers: ["google"],
        status,
        waitMs: 50,
      }),
    );
  }

  test("a server of Eva's that failed becomes a notice with the engine's reason, and the turn goes on", async () => {
    const events = await mapped([{ name: "google", status: "failed" }], () =>
      Promise.resolve([{ name: "google", status: "failed", error: "spawn uvx ENOENT" }]),
    );
    expect(events).toEqual([
      { kind: "notice", text: 'Eva could not start the MCP server "google": spawn uvx ENOENT' },
      expect.objectContaining({ kind: "turn_finished" }) as EngineEventPayload,
    ]);
  });

  test("a server that started, still starts, or is the person's own gives no notice and no question", async () => {
    let asked = 0;
    const events = await mapped(
      [
        { name: "google", status: "connected" },
        { name: "own-server", status: "failed" },
      ],
      () => {
        asked += 1;
        return Promise.resolve([]);
      },
    );
    const pending = await mapped([{ name: "google", status: "pending" }], () => Promise.resolve([]));
    expect([...events, ...pending].map((event) => event.kind)).toEqual(["turn_finished", "turn_finished"]);
    expect(asked).toBe(0);
  });

  test("a server that needs a login, or a status that fails or never comes, still gives a notice", async () => {
    const login = await mapped([{ name: "google", status: "needs-auth" }], () => Promise.resolve([]));
    const failed = await mapped([{ name: "google", status: "failed" }], () => Promise.reject(new Error("closed")));
    const silent = await mapped([{ name: "google", status: "failed" }], () => new Promise(() => undefined));
    expect([login[0], failed[0], silent[0]]).toEqual([
      { kind: "notice", text: 'Eva could not start the MCP server "google": it needs a login.' },
      { kind: "notice", text: 'Eva could not start the MCP server "google": Claude Code gave no reason.' },
      { kind: "notice", text: 'Eva could not start the MCP server "google": Claude Code gave no reason.' },
    ]);
  });

  test("a server still starting at init that fails later gives its notice before the turn ends", async () => {
    const failedLater = await mapped([{ name: "google", status: "pending" }], () =>
      Promise.resolve([{ name: "google", status: "failed", error: "uvx timed out" }]),
    );
    const startedLater = await mapped([{ name: "google", status: "pending" }], () =>
      Promise.resolve([{ name: "google", status: "connected" }]),
    );
    expect(failedLater.map((event) => event.kind)).toEqual(["notice", "turn_finished"]);
    expect(failedLater[0]).toEqual({
      kind: "notice",
      text: 'Eva could not start the MCP server "google": uvx timed out',
    });
    expect(startedLater.map((event) => event.kind)).toEqual(["turn_finished"]);
  });

  /**
   * The SDK closes the CLI's stdin at the result of a one-message turn, so a status request after
   * it never gets an answer. This fake answers only before the result.
   */
  function closingAtResult(answer: McpServerStatus[]): Promise<EngineEventPayload[]> {
    let ended = false;
    const answerLine = loadCapture("new-turn-with-tool").find(
      (line): line is SDKMessage => line.type === "assistant" && line.parent_tool_use_id === null,
    )!;
    const messages = (async function* () {
      await Promise.resolve();
      yield initLine([{ name: "google", status: "pending" }]);
      yield answerLine;
      ended = true;
      yield resultOf("new-turn-with-tool");
    })();
    return drain(
      mapSdkMessages(messages, {
        servers: ["google"],
        status: () => (ended ? new Promise(() => undefined) : Promise.resolve(answer)),
        waitMs: 50,
      }),
    );
  }

  test("a server still starting at init is asked about while the turn runs, before the SDK closes stdin", async () => {
    const failed = await closingAtResult([{ name: "google", status: "failed", error: "uvx timed out" }]);
    const started = await closingAtResult([{ name: "google", status: "connected" }]);
    const starting = await closingAtResult([{ name: "google", status: "pending" }]);
    const notices = (events: EngineEventPayload[]): EngineEventPayload[] =>
      events.filter((event) => event.kind === "notice");
    expect(notices(failed)).toEqual([
      { kind: "notice", text: 'Eva could not start the MCP server "google": uvx timed out' },
    ]);
    expect(notices(started)).toEqual([]);
    expect(notices(starting)).toEqual([
      {
        kind: "notice",
        text: 'Eva could not start the MCP server "google": it was still starting when the model answered.',
      },
    ]);
  });

  test("a query with no status request still gives the notice, with no reason", async () => {
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      query: () => replay([initLine([{ name: "google", status: "failed" }]), resultOf("new-turn-with-tool")]),
    });
    const events = await drain(
      engine.runTurn(request({ mcpServers: { google: { command: "uvx", args: [], environment: {} } } })),
    );
    expect(events[0]).toEqual({
      kind: "notice",
      text: 'Eva could not start the MCP server "google": Claude Code gave no reason.',
    });
  });

  test("the engine checks the servers of the turn through the query's own status", async () => {
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      query: () =>
        Object.assign(replay([initLine([{ name: "google", status: "failed" }]), resultOf("new-turn-with-tool")]), {
          mcpServerStatus: () =>
            Promise.resolve<McpServerStatus[]>([{ name: "google", status: "failed", error: "timed out" }]),
        }),
    });
    const events = await drain(
      engine.runTurn(request({ mcpServers: { google: { command: "uvx", args: [], environment: {} } } })),
    );
    expect(events[0]).toEqual({ kind: "notice", text: 'Eva could not start the MCP server "google": timed out' });
  });
});

describe("ClaudeCodeEngine", () => {
  test("carries a chat to another folder through its config folder (issue 523)", () => {
    const config = mkdtempSync(join(tmpdir(), "eva-claude-carry-"));
    try {
      const engine = new ClaudeCodeEngine({ executable: "/bin/claude" });
      const input = { engineSessionId: "abc", toFolder: "/clones/clone-1", environment: { CLAUDE_CONFIG_DIR: config } };
      expect(engine.carryHistory(input)).toBe(false);
    } finally {
      rmSync(config, { recursive: true, force: true });
    }
  });

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

  test("runs each chat in the permission mode of its setting", async () => {
    const seen: Options[] = [];
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      permissionMode: "bypassPermissions",
      query: ({ options }) => {
        seen.push(options);
        return replay(loadCapture("resumed-turn"));
      },
    });
    await drain(engine.runTurn(request()));
    expect(seen[0]?.permissionMode).toBe("bypassPermissions");
  });

  test("each event arrives while the turn still runs, not at its end (issue #40)", async () => {
    const lines = loadCapture("resumed-turn").filter(isMessage);
    const result = lines.find((message) => message.type === "result");
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      query: () =>
        (async function* () {
          yield* lines.filter((message) => message.type !== "result");
          await finished;
          if (result !== undefined) yield result;
        })(),
    });
    const events = engine.runTurn(request())[Symbol.asyncIterator]();
    expect((await events.next()).value).toMatchObject({ kind: "text" });
    finish();
    expect((await events.next()).value).toMatchObject({ kind: "turn_finished" });
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

  test("a lost history after a shown event is a plain failure, so no shown text repeats", async () => {
    let calls = 0;
    const text = loadCapture("resumed-turn")
      .filter(isMessage)
      .filter((message) => message.type === "assistant");
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      query: () => {
        calls += 1;
        return replay([...text, ...loadCapture("missing-session")]);
      },
    });
    const events = await drain(engine.runTurn(request({ history: { kind: "continue", engineSessionId: "s1" } })));
    expect(events.map((event) => event.kind)).toEqual(["text", "turn_failed"]);
    expect(calls).toBe(1);
  });

  test("the failed first run is closed before the retry starts", async () => {
    const closed: number[] = [];
    let calls = 0;
    const engine = new ClaudeCodeEngine({
      executable: "/bin/claude",
      newSessionId: () => "session-2",
      query: () => {
        calls += 1;
        const run = calls;
        const lines = loadCapture(run === 1 ? "missing-session" : "resumed-turn").filter(isMessage);
        return (async function* () {
          try {
            await Promise.resolve();
            yield* lines;
          } finally {
            closed.push(run);
          }
        })();
      },
    });
    const seen: string[] = [];
    for await (const event of engine.runTurn(request({ history: { kind: "continue", engineSessionId: "s1" } }))) {
      if (event.kind === "text") seen.push(`text, closed: ${closed.join(",")}`);
    }
    expect(seen).toEqual(["text, closed: 1"]);
  });

  test("Assistant mode asks for approval only for outward actions and schedule changes", async () => {
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
    expect(await canUseTool?.("Write", { file_path: ".eva/schedules.json" })).toMatchObject({ behavior: "deny" });
    expect(await canUseTool?.("Bash", { command: "git status" })).toMatchObject({ behavior: "allow" });
    expect(await canUseTool?.("Bash", { command: "gh issue create --title x" })).toMatchObject({ behavior: "deny" });
    expect(await canUseTool?.("mcp__google__send_email", { to: "a@b.c" })).toMatchObject({ behavior: "deny" });
    expect(asked).toEqual([
      "Write: Write .eva/schedules.json",
      "Bash: gh issue create --title x",
      'mcp__google__send_email: {"to":"a@b.c"}',
    ]);
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

  test("A model call denies every tool without a question", async () => {
    let canUseTool: ((name: string, input: Record<string, unknown>) => Promise<unknown>) | undefined;
    const asked: string[] = [];
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
    const callRequest = request({
      mode: "model-call",
      requestApproval: (approval) => {
        asked.push(approval.toolName);
        return Promise.resolve("allow");
      },
    });
    await drain(engine.runTurn(callRequest));
    expect(await canUseTool?.("Read", { file_path: "notes.md" })).toMatchObject({ behavior: "deny" });
    expect(asked).toEqual([]);
  });
});

type CanUseTool = (
  name: string,
  input: Record<string, unknown>,
) => Promise<{ behavior: string } & Record<string, unknown>>;

describe("AskUserQuestion (issue #544)", () => {
  const formatQuestion = {
    question: "Which format?",
    header: "Format",
    options: [
      { label: "Talk", description: "A one-to-one talk." },
      { label: "Form", description: "A form with scores.", preview: "Score: 1-5" },
    ],
    multiSelect: false,
  };
  const toolsQuestion = {
    question: "Which tools?",
    header: "Tools",
    options: [
      { label: "git", description: "" },
      { label: "uv", description: "" },
    ],
    multiSelect: true,
  };

  /** The engine's canUseTool for one turn, and the questions that reached the person. */
  async function gate(
    outcome: QuestionsOutcome,
    overrides: Partial<TurnRequest> = {},
  ): Promise<{ canUseTool: CanUseTool; asked: unknown[]; approvals: string[] }> {
    let canUseTool: CanUseTool | undefined;
    const asked: unknown[] = [];
    const approvals: string[] = [];
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
    const turnRequest = request({
      requestApproval: (approval) => {
        approvals.push(approval.toolName);
        return Promise.resolve("allow");
      },
      askQuestions: (toolName, questions) => {
        asked.push({ toolName, questions });
        return Promise.resolve(outcome);
      },
      ...overrides,
    });
    await drain(engine.runTurn(turnRequest));
    if (canUseTool === undefined) throw new Error("The engine never ran the query.");
    return { canUseTool, asked, approvals };
  }

  test("the questions reach the person, and the answers reach the model by question text", async () => {
    for (const mode of ["assistant", "project"] as const) {
      const { canUseTool, asked, approvals } = await gate([{ selected: [1] }, { selected: [0, 1] }], { mode });
      const input = { questions: [formatQuestion, toolsQuestion] };
      expect(await canUseTool("AskUserQuestion", input)).toEqual({
        behavior: "allow",
        updatedInput: { ...input, answers: { "Which format?": "Form", "Which tools?": "git, uv" } },
      });
      // The preview is optional, and Eva shows only the label and the description.
      expect(asked).toEqual([
        {
          toolName: "AskUserQuestion",
          questions: [
            {
              question: "Which format?",
              header: "Format",
              options: [
                { label: "Talk", description: "A one-to-one talk." },
                { label: "Form", description: "A form with scores." },
              ],
              multiSelect: false,
            },
            {
              question: "Which tools?",
              header: "Tools",
              options: [
                { label: "git", description: "" },
                { label: "uv", description: "" },
              ],
              multiSelect: true,
            },
          ],
        },
      ]);
      // An allow with no answers would tell the model that the person did not answer.
      expect(approvals).toEqual([]);
    }
  });

  test("the person's own text wins over the selected options", async () => {
    const { canUseTool } = await gate([{ selected: [0], other: "A short call" }]);
    const input = { questions: [formatQuestion] };
    expect(await canUseTool("AskUserQuestion", input)).toEqual({
      behavior: "allow",
      updatedInput: { ...input, answers: { "Which format?": "A short call" } },
    });
  });

  test("a skip tells the model that the person chose not to answer", async () => {
    const { canUseTool } = await gate("declined");
    expect(await canUseTool("AskUserQuestion", { questions: [formatQuestion] })).toEqual({
      behavior: "deny",
      message: "The person chose not to answer these questions.",
    });
  });

  test("a question that nobody answers in time makes the model ask in its reply", async () => {
    const { canUseTool } = await gate("expired");
    expect(await canUseTool("AskUserQuestion", { questions: [formatQuestion] })).toMatchObject({
      behavior: "deny",
      message: expect.stringContaining("plain text") as unknown,
    });
  });

  test("an input that Eva cannot read makes the model ask in its reply, with no form", async () => {
    const { canUseTool, asked } = await gate([{ selected: [0] }]);
    const unreadable = [
      {},
      { questions: [] },
      { questions: [{ question: "Which?", header: "H", options: "none", multiSelect: false }] },
      { questions: [{ ...formatQuestion, options: [{ label: " ", description: "" }, ...formatQuestion.options] }] },
      // The answers go back by question text, so two equal texts would lose one answer.
      { questions: [formatQuestion, formatQuestion] },
    ];
    for (const input of unreadable) {
      expect(await canUseTool("AskUserQuestion", input)).toMatchObject({
        behavior: "deny",
        message: expect.stringContaining("plain text") as unknown,
      });
    }
    expect(asked).toEqual([]);
  });

  test("answers that do not fit the questions make the model ask in its reply", async () => {
    for (const answers of [[{ selected: [0] }, { selected: [1] }], [{ selected: [5] }], [{ selected: [] }]]) {
      const { canUseTool } = await gate(answers);
      expect(await canUseTool("AskUserQuestion", { questions: [formatQuestion] })).toMatchObject({
        behavior: "deny",
        message: expect.stringContaining("plain text") as unknown,
      });
    }
  });

  test("a model call denies the questions, as it denies every tool", async () => {
    const { canUseTool, asked } = await gate([{ selected: [0] }], { mode: "model-call" });
    expect(await canUseTool("AskUserQuestion", { questions: [formatQuestion] })).toMatchObject({ behavior: "deny" });
    expect(asked).toEqual([]);
  });
});

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
