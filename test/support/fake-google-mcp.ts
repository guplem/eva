/**
 * A fake Google MCP server for tests. It speaks MCP over stdio, one
 * JSON-RPC message per line, offers `manage_event` like `workspace-mcp`, and appends each tool
 * call to the file in FAKE_MCP_LOG, so a test can see whether a call reached the server.
 */
import { appendFileSync } from "node:fs";

interface JsonRpcRequest {
  readonly id?: number;
  readonly method: string;
  readonly params?: { readonly name?: string; readonly arguments?: unknown };
}

const logPath = process.env["FAKE_MCP_LOG"] ?? "";

function reply(id: number | undefined, result: unknown): void {
  if (id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function handle(message: JsonRpcRequest): void {
  switch (message.method) {
    case "initialize":
      reply(message.id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-google", version: "1.0.0" },
      });
      return;
    case "tools/list":
      reply(message.id, { tools: [{ name: "manage_event", inputSchema: { type: "object" } }] });
      return;
    case "tools/call":
      appendFileSync(logPath, JSON.stringify(message.params) + "\n");
      reply(message.id, { content: [{ type: "text", text: "Event saved." }] });
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
