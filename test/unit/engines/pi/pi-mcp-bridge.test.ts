/**
 * The MCP bridge against the fake Google MCP server, with a fake pi extension API. A live run
 * inside a real pi is issue #59.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import evaMcpBridge, {
  mcpNoticePrefix,
  mcpServersFileVariable,
  startBridge,
  type BridgeOptions,
  type BridgePi,
} from "../../../../src/engines/pi/pi-mcp-bridge.ts";
import * as extension from "../../../../src/engines/pi/pi-mcp-extension.ts";

type Tool = Parameters<BridgePi["registerTool"]>[0];
type StartHandler = Parameters<BridgePi["on"]>[1];
interface Notice {
  readonly message: string;
  readonly type: string | undefined;
}

class FakeExtensionApi implements BridgePi {
  readonly tools: Tool[];
  private readonly shutdownHandlers: (() => Promise<void>)[];
  private readonly startHandlers: StartHandler[];

  constructor() {
    this.tools = [];
    this.shutdownHandlers = [];
    this.startHandlers = [];
  }

  registerTool(tool: Tool): void {
    this.tools.push(tool);
  }

  on(event: "session_start" | "session_shutdown", handler: StartHandler): void {
    if (event === "session_start") this.startHandlers.push(handler);
    else this.shutdownHandlers.push(handler as () => Promise<void>);
  }

  /** What pi's RPC client gets from each `notify` at the session start. */
  async startSession(): Promise<Notice[]> {
    const notices: Notice[] = [];
    const context = {
      ui: {
        notify: (message: string, type?: "info" | "warning" | "error") => {
          notices.push({ message, type });
        },
      },
    };
    for (const handler of this.startHandlers) await handler({}, context);
    return notices;
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.shutdownHandlers.map((handler) => handler()));
  }

  tool(name: string): Tool {
    const tool = this.tools.find((item) => item.name === name);
    if (tool === undefined) throw new Error(`No tool ${name}`);
    return tool;
  }
}

let folder: string;
let log: string;
let api: FakeExtensionApi;
let reports: string[];
beforeEach(() => {
  reports = [];
  Reflect.deleteProperty(process.env, mcpServersFileVariable);
  folder = mkdtempSync(join(tmpdir(), "eva-mcp-bridge-"));
  log = join(folder, "calls.jsonl");
  api = new FakeExtensionApi();
});
afterEach(async () => {
  await api.shutdown();
  Reflect.deleteProperty(process.env, mcpServersFileVariable);
  rmSync(folder, { recursive: true, force: true });
});

const fakeServer = join(import.meta.dir, "..", "..", "..", "support", "fake-google-mcp.ts");

function options(startTimeoutMs: number): BridgeOptions {
  return {
    startTimeoutMs,
    report: (line) => {
      reports.push(line);
    },
  };
}

function writeServers(servers: Record<string, unknown>): string {
  const file = join(folder, "servers.json");
  writeFileSync(file, JSON.stringify(servers));
  process.env[mcpServersFileVariable] = file;
  return file;
}

/** Windows needs SystemRoot to start a process. Eva's base environment holds it too. */
function baseEnvironment(): Record<string, string> {
  return Object.fromEntries(
    ["PATH", "Path", "SystemRoot"].flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
}

function google(): Record<string, unknown> {
  return { command: process.execPath, args: [fakeServer], environment: { ...baseEnvironment(), FAKE_MCP_LOG: log } };
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "no failure";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function logged(): Record<string, unknown>[] {
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** What reached the server, without the client's answers to the server's own requests. */
function calls(): Record<string, unknown>[] {
  return logged().filter((entry) => !("answer" in entry));
}

describe("the pi MCP bridge", () => {
  test("is what Eva writes for pi, and reads the variable that Eva sets", async () => {
    expect(extension.mcpExtensionSource).toBe(
      await Bun.file(join(import.meta.dir, "..", "..", "..", "..", "src", "engines", "pi", "pi-mcp-bridge.ts")).text(),
    );
    expect(extension.mcpServersFileVariable).toBe(mcpServersFileVariable);
    expect(extension.mcpNoticePrefix).toBe(mcpNoticePrefix);
  });

  test("registers every tool of every page under Claude Code's name, and deletes the specs", async () => {
    const file = writeServers({ google: google() });
    await evaMcpBridge(api);
    expect(api.tools.map((tool) => tool.name)).toEqual([
      "mcp__google__manage_event",
      "mcp__google__broken_tool",
      "mcp__google__rich_tool",
      "mcp__google__notes_read",
      "mcp__google__quota_tool",
      "mcp__google__slow_tool",
    ]);
    expect(api.tool("mcp__google__manage_event")).toMatchObject({
      label: "manage_event",
      description: "Create, change or delete a calendar event.",
      parameters: { type: "object", properties: { action: { type: "string" } } },
    });
    expect(process.env[mcpServersFileVariable]).toBeUndefined();
    expect(existsSync(file)).toBe(false);
  });

  test("a tool call reaches the server and returns its text", async () => {
    writeServers({ google: google() });
    await startBridge(api, options(10_000));
    const invite = { action: "create", attendees: ["friend@example.com"] };
    const result = await api.tool("mcp__google__manage_event").execute("c1", invite);
    expect(result).toEqual({ content: [{ type: "text", text: "Event saved." }], details: {} });
    expect(calls()).toEqual([{ name: "manage_event", arguments: invite }]);
  });

  test("answers the server's ping, refuses its other requests, and skips a line that is not JSON", async () => {
    writeServers({ google: google() });
    await startBridge(api, options(10_000));
    // A parser that broke on the line that is not JSON would lose this answer.
    expect(await api.tool("mcp__google__manage_event").execute("c1", {})).toMatchObject({ details: {} });
    await api.shutdown();
    expect(logged().filter((entry) => "answer" in entry)).toEqual([
      { answer: { jsonrpc: "2.0", id: 900, result: {} } },
      { answer: { jsonrpc: "2.0", id: 901, error: { code: -32601, message: "Method not found" } } },
    ]);
  });

  test("keeps text and images, gives a resource's text, and names any other part", async () => {
    writeServers({ google: google() });
    await startBridge(api, options(10_000));
    expect(await api.tool("mcp__google__rich_tool").execute("c1", {})).toEqual({
      content: [
        { type: "image", data: "AAA=", mimeType: "image/png" },
        { type: "text", text: "A note." },
        { type: "text", text: "[audio not shown]" },
      ],
      details: {},
    });
    expect(api.tool("mcp__google__rich_tool").parameters).toEqual({ type: "object", properties: {} });
  });

  test("pi's shutdown stops the servers", async () => {
    writeServers({ google: google() });
    await startBridge(api, options(10_000));
    await api.shutdown();
    expect(await failureOf(api.tool("mcp__google__manage_event").execute("c1", {}))).toBe("The server stopped.");
  });

  test("a failed tool throws, so pi marks the call as failed", async () => {
    writeServers({ google: google() });
    await startBridge(api, options(10_000));
    expect(await failureOf(api.tool("mcp__google__broken_tool").execute("c1", {}))).toBe("No such calendar.");
    expect(await failureOf(api.tool("mcp__google__quota_tool").execute("c2", {}))).toBe("Quota exceeded");
  });

  test("a stop ends the wait and tells the server", async () => {
    writeServers({ google: google() });
    await startBridge(api, options(10_000));
    const controller = new AbortController();
    const call = api.tool("mcp__google__slow_tool").execute("c1", {}, controller.signal);
    controller.abort();
    expect(await failureOf(call)).toBe("The tool call was stopped.");
    expect(await failureOf(api.tool("mcp__google__slow_tool").execute("c2", {}, controller.signal))).toBe(
      "The tool call was stopped.",
    );
    // The server reads stdin in order and before it exits, so the log is complete after the stop.
    await api.shutdown();
    expect(calls()).toEqual([
      { name: "slow_tool", arguments: {} },
      { cancelled: { requestId: 4, reason: "The person stopped the turn." } },
    ]);
  });

  test("a server that does not start or does not answer costs its tools, never the turn", async () => {
    writeServers({
      missing: { command: join(folder, "no-such-program"), args: [], environment: {} },
      // Not an array, so spawn throws at once.
      broken: { command: process.execPath, args: 3, environment: {} },
      silent: {
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        environment: baseEnvironment(),
      },
    });
    await startBridge(api, options(500));
    expect(api.tools).toEqual([]);
    // A second start on the same pi, so a slow cold start of the fake races no short deadline.
    writeServers({ google: google() });
    await startBridge(api, options(10_000));
    expect(api.tools.map((tool) => tool.name)).toEqual([
      "mcp__google__manage_event",
      "mcp__google__broken_tool",
      "mcp__google__rich_tool",
      "mcp__google__notes_read",
      "mcp__google__quota_tool",
      "mcp__google__slow_tool",
    ]);
    // Each report names its server or tool. The reason after the name comes from the system.
    expect(reports.map((line) => line.slice(0, line.indexOf('": ') + 1)).toSorted()).toEqual([
      'Eva could not start the MCP server "broken"',
      'Eva could not start the MCP server "missing"',
      'Eva could not start the MCP server "silent"',
      'Eva skipped the MCP tool "mcp__google__a_tool_with_a_name_that_is_too_long_for_a_model_provider"',
    ]);
    expect(reports.find((line) => line.includes('"silent"'))).toMatch(/No answer to initialize after \d+ ms\.$/);
  });

  test("tells pi's client each problem at the session start, so the person sees it", async () => {
    writeServers({ missing: { command: join(folder, "no-such-program"), args: [], environment: {} } });
    await startBridge(api, options(1_000));
    const notices = await api.startSession();
    expect(notices).toEqual([{ message: `${mcpNoticePrefix}${reports[0] ?? ""}`, type: "error" }]);
    expect(reports[0]).toStartWith('Eva could not start the MCP server "missing": ');
  });

  test("a server that starts tells pi's client only of the tools that it skipped", async () => {
    writeServers({ google: google() });
    await startBridge(api, options(10_000));
    expect((await api.startSession()).map((notice) => notice.message)).toEqual([
      `${mcpNoticePrefix}Eva skipped the MCP tool "mcp__google__a_tool_with_a_name_that_is_too_long_for_a_model_provider": its name is too long.`,
    ]);
  });

  test("no specs, or a broken specs file, starts no server", async () => {
    await startBridge(api, options(1_000));
    writeFileSync(join(folder, "servers.json"), "{");
    process.env[mcpServersFileVariable] = join(folder, "servers.json");
    await startBridge(api, options(1_000));
    expect(api.tools).toEqual([]);
  });
});
