/**
 * The pi extension that gives pi Eva's MCP servers, such as the Google tools. pi has no MCP
 * support, so this file is a small MCP client: for each server it starts the server, lists
 * its tools over stdio, and registers each tool with pi as `mcp__<server>__<tool>`. Claude Code
 * uses the same names, so the shared approval rule applies to both engines.
 *
 * pi loads this file as text with `-e` (see pi-mcp-extension.ts), so it imports nothing but
 * Node modules. It spawns directly because it runs inside pi, outside Eva's process seams.
 * Each wait has a bound, and pi's abort stops a tool call.
 */
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

/** The variable that names the file of server specs. pi-mcp-extension.ts holds the same name for Eva. */
export const mcpServersFileVariable = "EVA_MCP_SERVERS_FILE";

/** `uvx` can download the server on its first start. */
const defaultStartTimeoutMs = 60_000;
const protocolVersion = "2025-06-18";
/** A bound on `tools/list` pages, so a broken server cannot loop forever. */
const maxToolPages = 20;
const stopWaitMs = 1_000;

interface ServerSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
}

interface McpTool {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

interface McpContentPart {
  readonly type: string;
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
  readonly resource?: { readonly uri?: string; readonly text?: string };
}

type ToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

/** The part of pi's extension API that the bridge uses. */
export interface BridgePi {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute(
      toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<{ content: ToolContent[]; details: Record<string, never> }>;
  }): void;
  on(event: "session_shutdown", handler: () => Promise<void>): void;
}

interface McpClient {
  request(method: string, params: unknown, timeoutMs: number | null, signal?: AbortSignal): Promise<unknown>;
  notify(method: string, params: unknown): void;
  /** Ends stdin, which asks the server to stop, and stops it hard after a short wait (lesson 81). */
  close(): Promise<void>;
}

export default async function evaMcpBridge(pi: BridgePi): Promise<void> {
  await startBridge(pi, { startTimeoutMs: defaultStartTimeoutMs });
}

export async function startBridge(pi: BridgePi, options: { readonly startTimeoutMs: number }): Promise<void> {
  const servers = readServers();
  const clients: McpClient[] = [];
  // pi waits for this handler, so the servers stop before pi exits.
  pi.on("session_shutdown", async () => {
    await Promise.all(clients.map((client) => client.close()));
  });
  // In parallel, so two slow servers do not add up their waits.
  await Promise.all(
    Object.entries(servers).map(async ([server, spec]) => {
      const client = connect(spec);
      clients.push(client);
      // One deadline for the whole start, not one per request.
      const deadline = Date.now() + options.startTimeoutMs;
      const remaining = (): number => Math.max(0, deadline - Date.now());
      try {
        await client.request(
          "initialize",
          { protocolVersion, capabilities: {}, clientInfo: { name: "eva", version: "1" } },
          remaining(),
        );
        client.notify("notifications/initialized", {});
        for (const tool of await listTools(client, remaining)) register(pi, client, server, tool);
      } catch (error) {
        // A server that fails costs its tools, never the turn.
        await client.close();
        process.stderr.write(`Eva could not start the MCP server "${server}": ${messageOf(error)}\n`);
      }
    }),
  );
}

/** Reads the specs once and deletes them: they hold secrets, and pi's shell tool must not find them. */
function readServers(): Record<string, ServerSpec> {
  const file = process.env[mcpServersFileVariable];
  Reflect.deleteProperty(process.env, mcpServersFileVariable);
  if (file === undefined || file === "") return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, ServerSpec>;
  } catch {
    return {};
  } finally {
    rmSync(file, { force: true });
  }
}

async function listTools(client: McpClient, remaining: () => number): Promise<McpTool[]> {
  const tools: McpTool[] = [];
  let cursor: unknown;
  for (let page = 0; page < maxToolPages; page += 1) {
    const result = (await client.request("tools/list", typeof cursor === "string" ? { cursor } : {}, remaining())) as {
      tools?: McpTool[];
      nextCursor?: unknown;
    };
    tools.push(...(result.tools ?? []));
    cursor = result.nextCursor;
    if (typeof cursor !== "string" || cursor === "") break;
  }
  return tools;
}

function register(pi: BridgePi, client: McpClient, server: string, tool: McpTool): void {
  pi.registerTool({
    name: `mcp__${server}__${tool.name}`,
    label: tool.title ?? tool.name,
    description: tool.description ?? tool.name,
    // pi accepts a plain JSON Schema as well as a TypeBox one.
    parameters: tool.inputSchema ?? { type: "object", properties: {} },
    async execute(_toolCallId, params, signal) {
      // No time bound: a slow Drive read is normal, and pi's abort stops the wait.
      const result = (await client.request("tools/call", { name: tool.name, arguments: params }, null, signal)) as {
        content?: McpContentPart[];
        isError?: boolean;
      };
      const content = toolContent(result.content ?? []);
      if (result.isError === true) {
        // pi marks a tool call as failed only when execute throws.
        throw new Error(
          content.map((part) => (part.type === "text" ? part.text : "")).join("\n") || "The tool failed.",
        );
      }
      return { content, details: {} };
    },
  });
}

/** Keeps text and images, which pi takes in the same shape, and names every other part. */
function toolContent(parts: readonly McpContentPart[]): ToolContent[] {
  return parts.map((part): ToolContent => {
    if (part.type === "text") return { type: "text", text: part.text ?? "" };
    if (part.type === "image" && part.data !== undefined && part.mimeType !== undefined) {
      return { type: "image", data: part.data, mimeType: part.mimeType };
    }
    if (part.type === "resource" && typeof part.resource?.text === "string") {
      return { type: "text", text: part.resource.text };
    }
    return { type: "text", text: `[${part.type} not shown]` };
  });
}

/** One stdio MCP connection: JSON-RPC 2.0, one message per line. */
function connect(spec: ServerSpec): McpClient {
  const child = spawn(spec.command, [...spec.args], {
    env: { ...spec.environment },
    // The server logs to stderr; a pipe that nobody reads could block it.
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let buffer = "";
  let stopped = false;

  const failAll = (error: Error): void => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  const write = (message: Record<string, unknown>): void => {
    if (child.stdin.writable) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };
  const receive = (line: string): void => {
    let message: { id?: unknown; method?: unknown; result?: unknown; error?: { message?: unknown } };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    if (typeof message.method === "string") {
      // A request from the server. Only `ping` has an answer; a notification needs none.
      if (message.id === undefined) return;
      if (message.method === "ping") write({ id: message.id, result: {} });
      else write({ id: message.id, error: { code: -32601, message: "Method not found" } });
      return;
    }
    const waiter = typeof message.id === "number" ? pending.get(message.id) : undefined;
    if (waiter === undefined || typeof message.id !== "number") return;
    pending.delete(message.id);
    if (message.error !== undefined)
      waiter.reject(
        new Error(typeof message.error.message === "string" ? message.error.message : "The server failed."),
      );
    else waiter.resolve(message.result ?? {});
  };

  child.on("error", (error) => {
    failAll(error);
  });
  child.on("exit", () => {
    stopped = true;
    failAll(new Error("The server stopped."));
  });
  // A write after the server stopped must not crash pi.
  child.stdin.on("error", () => undefined);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      receive(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  });

  return {
    request: (method, params, timeoutMs, signal) =>
      new Promise((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const settle = (): void => {
          pending.delete(id);
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        };
        const onAbort = (): void => {
          settle();
          // The server may still finish a write; the model is told that the call stopped.
          write({
            method: "notifications/cancelled",
            params: { requestId: id, reason: "The person stopped the turn." },
          });
          reject(new Error("The tool call was stopped."));
        };
        if (signal?.aborted === true) {
          reject(new Error("The tool call was stopped."));
          return;
        }
        if (stopped) {
          reject(new Error("The server stopped."));
          return;
        }
        pending.set(id, {
          resolve: (value) => {
            settle();
            resolve(value);
          },
          reject: (error) => {
            settle();
            reject(error);
          },
        });
        if (timeoutMs !== null) {
          timer = setTimeout(() => {
            settle();
            reject(new Error(`No answer to ${method} after ${String(timeoutMs)} ms.`));
          }, timeoutMs);
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        write({ id, method, params });
      }),
    notify: (method, params) => {
      write({ method, params });
    },
    close: async () => {
      if (child.pid === undefined || stopped) return;
      child.stdin.end();
      // Well under the 5 s that Eva gives pi to close.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, stopWaitMs);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
