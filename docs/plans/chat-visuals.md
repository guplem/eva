# Plan: update the chat visuals (#41)

This is the working plan for #41. The last commit of the PR deletes it.

## Goal

The web app shows what happens in a chat, not only the answer:

- A side panel shows the chat: its model, engine and mode, how much context the last answer used, and the background tasks.
- Each answer shows the steps of its turn as a row of small badges: a message, a command, a tool or a task. A badge shows its detail on hover, and the row opens a list of all steps on a tap.
- Only the last message of a turn shows in full. While a turn runs, each new message replaces the last one, and the older one becomes a badge.

## Current state

- A stored turn has `answerText` (all messages joined), `toolCount`, `commandCount` and `taskCount`. It has no list of steps, and no usage.
- The live state of the web app keeps one string per running session (`streaming`) and the background tasks. It drops `tool_started` and `tool_finished`.
- The right panel (`TasksPanel`) shows only the background tasks. It hides on a phone.

## Gaps

1. **Where the steps live.** The web app must show the steps after a reload, so the core stores them.
2. **The step shape.** Each step needs a kind and a short text for the badge and the hover.
3. **Context info.** `turn_finished.usage` is the total of all model calls in the turn, in both engines. It overstates the context.
4. **Cost.** Claude Code sends the session total so far. Pi sends the cost of the turn, and 0 when it does not know.
5. **Phone.** A phone has no hover and no side panel.
6. **Old turns.** A stored turn from before this change has no steps.
7. **Size.** `state/sessions.json` is rewritten on each save, and the web app fetches all sessions after each turn.

## Decisions

1. One pure module, `src/shared/turn-steps.ts`, turns events into steps. The session manager and the web app both use it, so the stored steps and the live steps agree.
2. A step is `{ kind: "message" | "command" | "tool" | "task", text, isError, id }`. `id` is the tool use id or the task id, so `tool_finished` can mark its step. A task adds one step, on its first `task_changed`.
3. The steps come from the payload after redaction. The cut to 200 characters comes after it too, so a cut never splits a secret (lesson 95).
4. The turn record gets `steps` (default `[]`) and `omittedSteps` (default 0). The last message keeps its full text. Every other step keeps 200 characters. A turn keeps its last 100 steps, and `omittedSteps` counts the rest. `answerText` stays as it is, because the schedules read it.
5. `turn_finished` gets `contextTokens: number | null`: the input, cache read and cache write tokens of the last top-level model call. Each adapter computes it. The turn record stores it (default null). The panel shows the number of tokens, with no percent, because Eva does not know the context window of a model alias.
6. Cost stays out of #41. The two engines mean different things by `costUsd`.
7. Each answer shows one button with the badges, then the last message in full. A badge is a `span` with `role="img"`, an `aria-label` and a `title`. The button opens the step list in place, below the answer body, so a tap works on a phone. An old turn with no steps shows `answerText`, as now.
8. The live state keeps a step list per running session in place of the `streaming` string. `recover()` clears it, as it clears `streaming` now. The "history is lost" note becomes a message step. The running answer shows the badges and the last message, with `aria-live` on the message only.
9. `TasksPanel.tsx` becomes `ChatPanel.tsx`. The side panel "This chat" shows the model, engine and mode of the chat, the number of branches and answers, the context of the newest answer in the tree, and the background tasks. On a phone, a "Chat info" button in the chat header opens the same content in a dialog. Both modes use it.
10. The activity chip ("1 command, 1 tool") stays.

## Known limits

- Pi sends no `task_changed`, so a pi chat shows no task badges.
- Claude Code sends one message step for each text block. Pi sends one for each message.
- A reload during a turn loses the live steps until the turn ends, as the live text today.

## Steps

1. Shared: `turn-steps.ts` with unit tests.
2. Engines: `contextTokens` in both adapters.
3. Core: store the steps and `contextTokens` of each turn.
4. Web: live steps, the badge row and the last message.
5. Web: the chat panel and the phone dialog.
6. E2E tests.
7. Delete this plan.
