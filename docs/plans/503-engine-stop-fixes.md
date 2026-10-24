# Plan: pi hard stop and voice note cleanup (#503)

## Motivation

Stop must end a turn from the phone. A pi that ignores the RPC abort keeps the turn open for good. The 2-hour turn timeout aborts the same signal, so it cannot end the turn either. A voice note must never stay on disk (lesson 123).

## Changes

1. `src/engines/pi/pi-adapter.ts`: on abort, send the RPC abort as now. Also start a grace timer. When it fires, call `pi.close(0)`, which ends stdin and stops the process tree. Clear the timer in `finally`. The record stream then ends, and the turn ends with one `turn_failed`.
2. A turn whose signal is aborted and whose stream ends with no turn end fails with "The turn was stopped.", not with "pi stopped before the turn ended."
3. `src/core/voice/transcriber.ts`: delete the folder with retries, in a try/catch, as `removeFolder` in `model-calls.ts` does.

## Gaps and decisions

- **Grace time.** Decision: 15 seconds, as an option (`stopGraceMs`) so tests use a short time. pi answers an abort in well under a second when it is healthy. 15 seconds is short enough for a person who taps Stop.
- **A second `close` call.** The grace timer closes pi, and `streamTurn` closes it again after the loop. Checked in Bun: a second `stdin.end()` and a write after the end do not throw. `stopProcessTree` on a process that ended is harmless.
- **`model-calls.ts`.** Decision: no change. The call aborts its controller in `finally`, so the adapter's grace timer now stops pi. A test proves that a model call on a silent pi closes it.
- **Retries for the voice folder.** Decision: `maxRetries: 5, retryDelay: 200`, as the audit proposed. The note waits at most about one second more on Windows.

## Research note

The skill asks for sub-agents for each gap. This session could not start sub-agents, so the author did this research alone.
