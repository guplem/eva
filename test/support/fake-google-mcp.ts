/**
 * A fake Google MCP server for tests. It speaks MCP over stdio, one
 * JSON-RPC message per line, offers `manage_event` like `workspace-mcp`, and appends each tool
 * call and each cancel to the file in FAKE_MCP_LOG, so a test can see what reached the server.
 * Like a strict server, it lists tools only after `notifications/initialized`, and over two pages.
 */
import { appendFileSync } from "node:fs";

interface JsonRpcRequest {
  readonly id?: number;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly params?: { readonly name?: string; readonly arguments?: unknown; readonly cursor?: string };
}

const logPath = process.env["FAKE_MCP_LOG"] ?? "";
let initialized = false;

function reply(id: number | undefined, result: unknown): void {
  if (id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function fail(id: number | undefined, message: string): void {
  if (id !== undefined)
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32600, message } }) + "\n");
}

function callTool(message: JsonRpcRequest): void {
  appendFileSync(logPath, JSON.stringify(message.params) + "\n");
  switch (message.params?.name) {
    case "manage_event":
      reply(message.id, { content: [{ type: "text", text: "Event saved." }] });
      return;
    case "broken_tool":
      reply(message.id, { content: [{ type: "text", text: "No such calendar." }], isError: true });
      return;
    case "rich_tool":
      reply(message.id, {
        content: [
          { type: "image", data: "AAA=", mimeType: "image/png" },
          { type: "resource", resource: { uri: "file:///notes.txt", text: "A note." } },
          { type: "audio", data: "AAA=", mimeType: "audio/wav" },
        ],
      });
      return;
    case "quota_tool":
      fail(message.id, "Quota exceeded");
      return;
    case "slow_tool":
      // Never answers, so only a cancel ends the call.
      return;
    default:
      fail(message.id, "Unknown tool");
  }
}

function handle(message: JsonRpcRequest): void {
  // An answer from the client, such as to the ping or to an unknown request.
  if (message.method === undefined) {
    appendFileSync(logPath, JSON.stringify({ answer: message }) + "\n");
    return;
  }
  switch (message.method) {
    case "initialize":
      reply(message.id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-google", version: "1.0.0" },
      });
      return;
    case "notifications/initialized":
      initialized = true;
      // A server may ask the client something, and may write a line that is not JSON.
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 900, method: "ping" }) + "\n");
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 901, method: "roots/list" }) + "\n");
      process.stdout.write("Starting the fake server\n");
      return;
    case "notifications/cancelled":
      appendFileSync(logPath, JSON.stringify({ cancelled: message.params }) + "\n");
      return;
    case "tools/list":
      if (!initialized) {
        fail(message.id, "Not initialized");
      } else if (message.params?.cursor === "page-2") {
        reply(message.id, {
          tools: [
            { name: "broken_tool", inputSchema: { type: "object" } },
            { name: "rich_tool" },
            // A dot is valid in MCP, but not in a model provider's tool name.
            { name: "notes.read", inputSchema: { type: "object" } },
            { name: "a_tool_with_a_name_that_is_too_long_for_a_model_provider", inputSchema: { type: "object" } },
            { name: "quota_tool", inputSchema: { type: "object" } },
            { name: "slow_tool", inputSchema: { type: "object" } },
          ],
        });
      } else {
        reply(message.id, {
          tools: [
            {
              name: "manage_event",
              description: "Create, change or delete a calendar event.",
              inputSchema: { type: "object", properties: { action: { type: "string" } } },
            },
          ],
          nextCursor: "page-2",
        });
      }
      return;
    case "tools/call":
      callTool(message);
      return;
    default:
      reply(message.id, {});
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line.length > 0) handle(JSON.parse(line) as JsonRpcRequest);
    newline = buffer.indexOf("\n");
  }
});
