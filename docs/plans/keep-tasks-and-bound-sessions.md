# Keep background tasks after a reload, and bound the session list

Issue: #121.

## Why

The web app learns the background tasks only from `task_changed` events.
A reload, or a phone that sleeps through an event, empties the list.
The "This chat" panel then says that nothing runs, even when a task runs.
A finished task also stays in the list until a reload.

The web app also fetches every session with every turn after each turn and on each reconnect.
Each turn now keeps up to 100 steps of up to 200 characters.
A long chat makes this response grow without a limit, which costs a phone on each fetch.

## Plan

1. The session manager keeps the background tasks in memory, as it keeps the pending approvals.
2. The local API serves them at `GET /api/tasks`.
3. The web app reads them at start and on each reconnect, as it reads the approvals.
4. The session list sends the steps of the recent turns only.

## Gaps

- **G1. When does a finished task leave the list?**
- **G2. Which tasks does the core forget, and when?** A deleted chat, a turn that ends, a stopped engine.
- **G3. How is the session list bounded?** Steps for the open chat only, or steps for the last N turns only. Which N, and in which layer.
- **G4. What does the per-turn "N background tasks" dialog say** when its tasks are no longer in the list?

## Decisions

To be filled.
