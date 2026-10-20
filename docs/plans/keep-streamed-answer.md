# Keep the streamed answer when the web app comes back

Issue #118.

## Motivation

A phone drops the socket when the person switches apps. On return, `recover` in `App.tsx` clears the live steps of every running turn. The core writes the turn only at its end. So the answer blocks that the person already read vanish until the turn ends. Eva must work well from a phone.

## Design

- The core keeps the steps of each running turn, already redacted, in the session manager. It forgets them at the turn end, as it does for the tasks.
- `SessionManager.runningTurns()` returns `{ seq, turns: [{ sessionId, steps }] }`. It follows the pattern of `backgroundTasks()`.
- The local API serves it on `GET /api/turns`, next to `/api/tasks`.
- The web app reads it in `recover` and shows the steps again.

## Gaps and decisions

1. **Where the API returns the steps.** Decision: a new route, as `/api/tasks` and `/api/approvals` do. The session list stays small.
2. **Race between the reply and the events.** The reply and the socket travel apart (lesson 83). An event newer than the snapshot can arrive before the reply. Decision: while a recovery waits, the page keeps the events that it applies. At the reply, it starts from the snapshot steps and applies the kept events with a `seq` above the snapshot `seq` again. A turn end after the snapshot thus still removes the turn.
3. **What the page shows while it waits.** Decision: keep the old steps until the reply, so nothing blinks. When the request fails, clear them as before, and apply the kept events.
4. **Two recoveries at once** (a visibility change and a reconnect). Decision: count the open recoveries. Keep the events until the last one ends.
5. **A stored name changes?** No. The route and the snapshot are new. No event kind or stored field changes.
