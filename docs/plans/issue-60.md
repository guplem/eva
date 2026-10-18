# Plan: Google tools with pi (#60)

Delete this file before the merge. The decisions then live in the commits and in the pull request.

## Goal

A pi session in Assistant mode gets the same Google tools as Claude Code. pi has no MCP support (MCP: a standard way to give an agent extra tools), so Eva bridges it.

## Design

1. **A second Eva extension for pi: an MCP bridge,** in `src/engines/pi/pi-mcp-bridge.ts`. It is a real TypeScript module with Node imports only, so lint, the type check and the tests cover it. `pi-mcp-extension.ts` embeds it as text with `with { type: "text" }`, and Eva writes it to her pi work folder. For each server, the bridge starts the server over stdio, sends `initialize` and `notifications/initialized`, lists the tools over every page, and registers each tool with `pi.registerTool`.
2. **Tool names are `mcp__<server>__<tool>`,** the same names that Claude Code uses. The shared rule in `src/shared/outward-actions.ts` then applies to pi with no change.
3. **Approvals need no new code.** pi fires `tool_call` for every tool, the bridge tools too, so Eva's approval extension sees them. A calendar event with a guest asks the person.
4. **The server specs reach pi in a file, not in pi's environment.** Eva writes `mcp-servers/<session>.json` (mode 0600) and puts its path in `EVA_MCP_SERVERS_FILE`. The bridge reads the file at start, deletes it, and deletes the variable. A variable with the secret would stay readable in `/proc/<pid>/environ`. Eva also deletes the file after the turn, for a pi that stopped before the bridge ran.
5. **Eva loads the bridge only when the turn has MCP servers.** Project mode has none, so it stays a transparent wrapper.
6. **A failed server never breaks the turn.** One 60 s deadline covers the start of each server, because `uvx` can download `workspace-mcp` on the first start. The servers start in parallel. On a failure, the bridge registers no tools for that server and writes one line to stderr. A tool call has no time bound: pi's abort ends the wait and sends `notifications/cancelled`.
7. **pi stops the servers at `session_shutdown`:** it ends stdin, waits 1 s, then kills (lesson 81). The bridge never starts a server detached, so Eva's stop of pi's process group reaches it too.
8. **The bridge spawns directly.** It runs inside pi, outside Eva's seams. It gives each server the spec's whole environment, which Eva built with `buildChildEnvironment`.

## Tool results

- Text and image parts pass through: pi takes them in the same shape.
- A resource part with text becomes text. Every other part becomes a short `[<type> not shown]` line.
- An MCP `isError` result or a JSON-RPC error throws, so pi marks the call as failed.

## Tests

- Contract test: `buildPiArguments` loads the bridge with `-e` only when the turn has MCP servers. pi's environment holds the path of the specs file, and the file is gone after the turn.
- Bridge test: Bun runs the bridge with a fake pi extension API against `test/support/fake-google-mcp.ts`. The fake server is strict: it lists tools only after `notifications/initialized`, over two pages, and sends a `ping`.
- Approval test: a pi turn with `mcp__google__manage_event` and a guest asks the person.

## Out of scope

- A failed MCP server does not reach the phone, for either engine: issue #133.
- A live run inside a real pi is issue #59.
