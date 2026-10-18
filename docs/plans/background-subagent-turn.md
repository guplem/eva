# Keep a turn alive while a background subagent works

Issue #70.

## Motivation

Claude can start a subagent in the background. The SDK then sends a first `result`, then the subagent's messages, then a second turn with a second `result`, all in one stream. The adapter stops at the first `result`. The person never sees the subagent finish or the follow-up answer, on any front end.

## What a real stream shows

A capture from `claude` 2.1.302 and SDK 0.3.300, with a background subagent, sends these messages:

1. `assistant` with an `Agent` tool call, `task_started` with `is_backgrounded: true`, its `tool_result`.
2. `assistant` text, then `result` (`result_index` 0).
3. The subagent's own messages (`parent_tool_use_id` set), `task_notification` with `status: "completed"`.
4. A new `init`, `assistant` text, then `result` (`result_index` 1). Then the stream ends.

## Gaps and decisions

- **One turn end, or one for each `result`?** One. `src/engines/AGENTS.md` and `EnginePort.runTurn` say a turn stream ends with exactly one turn end. `SessionManager.runTurn` drops every event after the first end. So the adapter holds the end back until the stream ends. The person sees both answers in one turn.
- **When does the turn end?** When the SDK stream ends. In single-prompt mode the process exits after its last turn. The session's turn timeout still bounds a stream that never ends.
- **An error `result`?** It ends the turn at once, as now. The SDK throws right after it, and the lost-history retry needs the failure at once.
- **A throw after a success `result`?** It fails the turn. A stop or the turn timeout makes the SDK throw while the subagent works. The person must see that the rest of the turn is lost, so Telegram says "Stopped." (review finding).
- **A background shell task?** A live test shows that `claude -p` also waits for a background `Bash` task, then runs a follow-up turn. So a dev server holds the turn until the person stops it or the turn timeout fires. This equals a manual `claude -p` run, so Eva keeps it (project mode is a transparent wrapper).
- **Usage and cost.** `usage` on a result is for its own turn, so the end sums them (`TurnUsage` is "the sum over every model call of the turn"). `total_cost_usd` is a running total, so the end takes the last one. `contextTokens` and `lastMessageId` keep their meaning: the last top-level call and the last text.
- **The test fixture.** Add a `background-subagent` capture to `scripts/capture-claude-fixtures.ts`, and commit a real capture.
