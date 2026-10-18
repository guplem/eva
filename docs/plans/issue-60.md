# Plan: Google tools with pi (#60)

Delete this file before the merge. The decisions then live in the commits and in the pull request.

## Goal

A pi session in Assistant mode gets the same Google tools as Claude Code. pi has no MCP support (MCP: a standard way to give an agent extra tools), so Eva bridges it.

## Design

1. **A second Eva extension for pi: an MCP bridge.** Eva keeps its source as text, like `pi-approval-extension.ts`, and writes it to her pi work folder. The extension is a small MCP client. For each server, it starts the server over stdio, sends `initialize`, lists the tools, and registers each tool with `pi.registerTool`. A tool call sends `tools/call` and returns the text content.
2. **Tool names are `mcp__<server>__<tool>`,** the same names that Claude Code uses. The shared rule in `src/shared/outward-actions.ts` then applies to pi with no change.
3. **Approvals need no new code.** Eva's approval extension sees every tool call, the bridge tools too. A calendar event with a guest asks the person.
4. **The server specs reach pi in one environment variable, `EVA_MCP_SERVERS`, as JSON.** The extension reads it and deletes it from `process.env`. pi's shell tool reads `process.env` at each call, so a shell command never sees the Google client secret. No secret goes to disk or to the command line.
5. **Eva loads the bridge only when the turn has MCP servers.** Project mode has none, so it stays a transparent wrapper.
6. **A failed server never breaks the turn.** The extension waits a bounded time for each server. On a failure, it registers no tools for that server, writes one line to stderr, and pi runs on.
7. **pi stops the servers at `session_shutdown`.** When pi dies, the server sees the end of stdin. Eva's stop of pi's process group reaches it too.

## Tests

- Contract test: `buildPiArguments` loads the bridge with `-e` only when the turn has MCP servers, and the pi environment holds the exact `EVA_MCP_SERVERS` JSON.
- Bridge test: Bun runs the extension source with a fake `pi` API against `test/support/fake-google-mcp.ts`. It checks the registered names and schemas, a tool call, the delete of the variable, and a server that does not start.
- Approval test: a pi turn with `mcp__google__manage_event` and a guest asks the person, through the existing approval fixtures.

## Gaps

- **How the specs reach pi:** environment variable, deleted after the read (decision 4).
- **What a tool result holds:** the text parts of the MCP `content`, joined. An MCP `isError` result becomes a thrown error, so pi marks the call as failed.
- **Startup timeout:** 60 s per server. `uvx` can download `workspace-mcp` on the first start.
- **Docs:** update the Google line in `docs/guide/` if it says Claude Code only.
