# Plan: session turn fixes (#501)

## Motivation

Six bugs make a chat turn, a retry or a scheduled prompt do the wrong thing.
Eva must stop when the person says Stop, keep the history of a retry, and tell the phone when a schedule fails.

## Changes

1. **No follow-up after a stop or a failure.**
   `SessionManager.drain` queues a follow-up only when `runtime.stopped` is false.
   `AssistantPreparer.afterTurn` still saves the vault, but returns null when the turn did not finish.
2. **Retry answers at once.** `retry()` starts the send with `void` and returns the new branch. `send` never rejects.
3. **Retry keeps the history.**
   Walk back to the newest earlier turn that has a `lastMessageId`, and fork there.
   When no such turn exists and the chat is a fork, fork the parent at `forkAtMessageId`.
   Use `retryFromStart` only for a root chat.
4. **A failed scheduled prompt is a failure.**
   `ScheduledChatStarter.send` resolves to the failure reason of the last turn, or null.
   `SessionManager.lastTurnFailure(sessionId)` gives that reason.
   The scheduler records a failed run, logs it and reports it, so the `schedule:<id>` alert opens.
5. **An error after a turn never strands a chat.**
   `drain` catches an error of the work after each turn and logs it.
   Its `finally` arms the gather timer again when a batch still waits.
6. **A stop during the preparation step stops the turn.**
   `requestApproval` returns "expired" at once when the turn's signal is aborted.
   After `prepare`, an aborted turn throws, so the engine never starts.

## Gaps and decisions

No sub-agents were available in this session, so the author filled each gap by a search of the code.

- **Where an error after a turn goes.**
  A `notice` event after the end event makes the web app show a running turn (`live-state.ts`).
  Decision: add an optional `logger` to `SessionManagerOptions`, and wire it in `eva.ts`. The store and the preparers already log the same way.
- **A stopped scheduled turn.**
  The last turn then has the failure "The turn was stopped.".
  Decision: report it as a failed run. The scheduled work did not finish, and the next good run clears the alert.
- **The parent of a retry branch of a fork's first turn.**
  Decision: the fork's own parent, at the fork's `forkAtMessageId`. The branch is a sibling of the fork and has the same history.
  When that parent is gone, fall back to `retryFromStart`.
- **The scheduler's send type.**
  Decision: `send(sessionId, prompt): Promise<string | null>`. The wiring in `eva.ts` reads `lastTurnFailure` after the send.
