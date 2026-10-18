# Plan: tell the person when an MCP server fails to start

Issue: #133.

## Motivation

Assistant mode gets its Google tools from an MCP server that `uvx` starts. When the start fails, the turn runs without the tools, and the person sees no reason. The goal "every problem must reach the phone" breaks.

## Design

- Each engine sends the existing `notice` event when one of Eva's own MCP servers fails to start. The text names the server and gives the reason.
- The turn goes on without the server's tools.
- Telegram shows a `notice` in the chat's topic, in the chat's order, as it shows `history_lost`.
- The web app shows a `notice` as a live note of the turn, as it shows `history_lost`.

### Claude Code

- The SDK's `init` system message lists each MCP server with its status, but with no reason.
- When one of Eva's servers has the status `failed` or `needs-auth`, the adapter asks the query for `mcpServerStatus()`. That answer has the `error` text.
- The wait for that answer has a bound, so a slow answer never holds the turn.

### pi

- The bridge already collects each problem in one line.
- In pi's RPC mode, an extension's `ctx.ui.notify` becomes an `extension_ui_request` with the method `notify` (pi 0.73.1 `docs/rpc.md`). pi binds the UI context before it sends `session_start`.
- The bridge sends each problem line with `notify` at `session_start`, with a fixed prefix. The adapter turns each `notify` with that prefix into a `notice`.

## Gaps

1. **Where does the notice go: a per-turn notice or an alert?** Decision: a per-turn `notice`. The notice sits next to the answer that lacks the tools, and the event kind exists. An alert reaches only Telegram, not the web app.
2. **Which servers count?** Decision: only the servers in `request.mcpServers`. Project mode stays a transparent wrapper.
3. **Does the web app keep the notice after the turn?** Decision: no, as with `history_lost`. Telegram keeps it in the topic. A stored step kind is a schema change: a follow-up issue tracks it. A failed message step was the other option, but it hides the notice behind a badge and adds it to the whole answer.
4. **Does the notice repeat at each turn?** Decision: yes. Each turn lacks the tools again, and the person sees the cause where it matters.
5. **How does the pi adapter know a `notify` is Eva's?** Decision: a fixed prefix, kept equal in the bridge and the adapter by a test, as with `mcpServersFileVariable`. The adapter cuts the prefix off. A `notify` never reaches the dialog answer path.

## Notes from the gap check

- `McpServerStatus.error` exists only for `failed`. A `needs-auth` server gets a fixed reason. A `pending` server is no failure.
- The SDK's control request has no timeout of its own. The adapter races it against a timer and catches its failure. A notice with no reason still goes out.
- A tool that the bridge skips for its long name becomes a notice too.
- Telegram drops an event of a chat that has no topic yet. A chat that starts on the web then misses the notice in Telegram, as it misses `history_lost`.
