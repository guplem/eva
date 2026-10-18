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

- **A background task cannot outlive its turn.** The Claude Code adapter holds `turn_finished` until a background subagent ends (issue 70). A stop or a failure ends the `query`, and its process. The session manager drops each event after the turn end.
- **G2.** The session manager keeps the tasks of the running turns only. It forgets the tasks of a session when the turn ends, in `runTurn`'s `finally`. A delete needs nothing, because it refuses an active chat. A restart loses the map and the engine process together. So the map has a limit, and no task stays "running" forever.
- **G1.** A task leaves the list when its turn ends, done or not. The web app follows the same rule: `turn_finished` and `turn_failed` drop the tasks of that session. On each reconnect, the web app replaces its tasks with `GET /api/tasks`. The turn's steps keep the history of each task.
- **G3.** The `GET /api/sessions` route sends the steps of the last 10 turns of each session only. Older turns get `steps: []` and `omittedSteps: 0`, so the web app shows their whole answer text, as for a turn from before steps existed. The core and the store keep every step, because Telegram reads the full list in the process. No stored format changes. `userText` and `answerText` still grow with each turn: a summary list with a fetch for each chat is a larger change, out of scope.
- **G4.** The "N background tasks" button of a stored turn opens the task steps of that turn, with "failed" for a step with an error. A turn with no kept task steps says that Eva no longer keeps their details. The chip of a running turn still opens the live tasks.
