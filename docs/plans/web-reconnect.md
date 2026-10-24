# Plan: the web page reconnects by itself (#507)

## Motivation

Eva works from a phone. A phone sleeps, changes networks and drops sockets. The page must come back on its own, and one hung request must never lock it.

## Changes

1. Move the event stream logic out of `api.ts` into `client/event-stream.ts`, behind a socket seam, as `page-freshness.ts` does with `PagePlace`. `api.ts` keeps `subscribeToEvents` and gives it the browser's socket.
2. In the stream, start a 10 s timer at each connect. When the socket has not opened by then, call `retryNow()`.
3. Skip a frame that is not JSON.
4. In `App.tsx`, call `retryNow()` when the page shows again and on the browser's `online` event.
5. Add an optional time limit to `request()` in `api.ts`, with a testable helper in `client/time-limit.ts`. Use 20 s for `send`, `status`, `sessions`, `pendingApprovals`, `runningTurns`, `deviceRequests` and `backgroundTasks`. A timed-out send says that the message may have been sent.
6. Run the independent reads of `recover()` in parallel.

## Gaps and decisions

- **Where does the testable logic live?** `api.ts` has many API functions with no tests. A test that loads it at run time puts the whole file under the per-file coverage limit. Decision: put the logic in two new small modules with seams. This follows `page-freshness.ts`.
- **How does a request time out?** `test/AGENTS.md` says that an `AbortSignal.timeout` that never runs zeroes the coverage of its file. Decision: use an `AbortController` with `setTimeout`, and clear the timer at the end.
- **Which requests get a limit?** The audit names send, status, sessions and pending approvals. The other reads of `recover()` (`/api/turns`, `/api/tasks`, `/api/devices/requests`) are also synchronous reads of state in the core, so they get the same limit. Login, uploads, transcription and other long work get none. `POST .../messages` answers 202 at once, so 20 s is safe for a send.
- **What does a bad frame do?** The web client has no logger. Decision: skip the frame.
- **Double recovery on wake.** When the page shows and the socket is down, `recover()` runs, and the new socket's open runs it again. `recover()` already keeps only the newest run (`lastRecovery`), so this is safe.
- **Retry delay.** Keep the 2 s retry after a close. The audit does not ask for a backoff.

## Research note

The sub-agents of steps 3, 6 and 7 could not start in this environment. The implementer did the research and the reviews alone.
