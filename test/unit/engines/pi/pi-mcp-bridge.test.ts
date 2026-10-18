/**
 * The MCP bridge against the fake Google MCP server, with a fake pi extension API. A live run
 * inside a real pi is issue #59.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import evaMcpBridge, {
  mcpServersFileVariable,
  startBridge,
  type BridgePi,
} from "../../../../src/engines/pi/pi-mcp-bridge.ts";

type Tool = Parameters<BridgePi["registerTool"]>[0];

class FakeExtensionApi implements BridgePi {
  readonly tools: Tool[];
  private readonly shutdownHandlers: (() => Promise<void>)[];

  constructor() {
    this.tools = [];
    this.shutdownHandlers = [];
  }

  registerTool(tool: Tool): void {
    this.tools.push(tool);
  }

  on(_event: "session_shutdown", handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
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
beforeEach(() => {
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

function writeServers(servers: Record<string, unknown>): string {
  const file = join(folder, "servers.json");
  writeFileSync(file, JSON.stringify(servers));
  process.env[mcpServersFileVariable] = file;
  return file;
}

function google(): Record<string, unknown> {
  return { command: process.execPath, args: [fakeServer], environment: { FAKE_MCP_LOG: log } };
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "no failure";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function logged(): unknown[] {
  return readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
}

describe("the pi MCP bridge", () => {
  test("registers every tool of every page under Claude Code's name, and deletes the specs", async () => {
    const file = writeServers({ google: google() });
    await evaMcpBridge(api);
    expect(api.tools.map((tool) => tool.name)).toEqual([
      "mcp__google__manage_event",
      "mcp__google__broken_tool",
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
    await startBridge(api, { startTimeoutMs: 10_000 });
    const invite = { action: "create", attendees: ["friend@example.com"] };
    const result = await api.tool("mcp__google__manage_event").execute("c1", invite);
    expect(result).toEqual({ content: [{ type: "text", text: "Event saved." }], details: {} });
    expect(logged()).toEqual([{ name: "manage_event", arguments: invite }]);
  });

  test("pi's shutdown stops the servers", async () => {
    writeServers({ google: google() });
    await startBridge(api, { startTimeoutMs: 10_000 });
    await api.shutdown();
    expect(await failureOf(api.tool("mcp__google__manage_event").execute("c1", {}))).toBe("The server stopped.");
  });

  test("a failed tool throws, so pi marks the call as failed", async () => {
    writeServers({ google: google() });
    await startBridge(api, { startTimeoutMs: 10_000 });
    expect(await failureOf(api.tool("mcp__google__broken_tool").execute("c1", {}))).toBe("No such calendar.");
  });

  test("a stop ends the wait and tells the server", async () => {
    writeServers({ google: google() });
    await startBridge(api, { startTimeoutMs: 10_000 });
    const controller = new AbortController();
    const call = api.tool("mcp__google__slow_tool").execute("c1", {}, controller.signal);
    await Bun.sleep(100);
    controller.abort();
    expect(await failureOf(call)).toBe("The tool call was stopped.");
    await Bun.sleep(100);
    expect(logged()).toEqual([
      { name: "slow_tool", arguments: {} },
      { cancelled: { requestId: 4, reason: "The person stopped the turn." } },
    ]);
    expect(await failureOf(api.tool("mcp__google__slow_tool").execute("c2", {}, controller.signal))).toBe(
      "The tool call was stopped.",
    );
  });

  test("a server that does not start or does not answer costs its tools, never the turn", async () => {
    writeServers({
      missing: { command: join(folder, "no-such-program"), args: [], environment: {} },
      silent: { command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], environment: {} },
      google: google(),
    });
    await startBridge(api, { startTimeoutMs: 1_000 });
    expect(api.tools.map((tool) => tool.name)).toEqual([
      "mcp__google__manage_event",
      "mcp__google__broken_tool",
      "mcp__google__slow_tool",
    ]);
  });

  test("no specs, or a broken specs file, starts no server", async () => {
    await startBridge(api, { startTimeoutMs: 1_000 });
    writeFileSync(join(folder, "servers.json"), "{");
    process.env[mcpServersFileVariable] = join(folder, "servers.json");
    await startBridge(api, { startTimeoutMs: 1_000 });
    expect(api.tools).toEqual([]);
  });
});
