# Plan: update the chat visuals (#41)

This is the working plan for #41. The last commit of the PR deletes it.

## Goal

The web app shows what happens in a chat, not only the answer:

- A side panel shows the chat: its model, engine and mode, how much context the last turn used, its cost, and the background tasks.
- Each answer shows the steps of its turn as a row of small badges: a message, a command, a tool or a task. A badge shows its detail on hover, and the row opens a list of all steps on a tap.
- Only the last message of a turn shows in full. While a turn runs, each new message replaces the last one, and the older one becomes a badge.

## Current state

- A stored turn has `answerText` (all messages joined), `toolCount`, `commandCount` and `taskCount`. It has no list of steps, and no usage.
- The live state of the web app keeps one string per running session (`streaming`) and the background tasks. It drops `tool_started` and `tool_finished`.
- The right panel (`TasksPanel`) shows only the background tasks. It hides on a phone.

## Gaps

1. **Where the steps live.** The web app must show the steps after a reload, so the core stores them.
2. **The step shape.** Each step needs a kind and a short text for the badge and the hover.
3. **Context info.** `turn_finished` carries `usage` and `costUsd`. The turn record drops them.
4. **Phone.** A phone has no hover and no side panel.
5. **Old turns.** A stored turn from before this change has no steps.
6. **Message text size.** A message step that keeps the whole text copies `answerText`.

## Decisions

1. Add `steps` to the turn record: `{ kind: "message" | "command" | "tool" | "task", text, isError }`. It defaults to `[]`, so an old record still reads (lesson 54). The session manager adds one step for each `text` event, each `tool_started` and the first `task_changed` of each task. A `tool_finished` with `isError` marks its step.
2. A message step keeps its full text, already redacted. The other steps keep the event summary, cut to 200 characters. `answerText` stays as it is, because Telegram, the CLI and the schedules read it. The copy is small next to the session files of the engines.
3. Add `usage` (the `TurnUsage` fields, or null) and `costUsd` (or null) to the turn record. Both default to null. The context size of a chat is the input, cache read and cache write tokens of its last finished turn.
4. One pure module, `src/frontends/web/client/turn-steps.ts`, turns events into steps for the live view, and gives the summary text of a step list. Unit tests cover it. The stored steps and the live steps use the same shape.
5. Each answer shows a badge row, then the last message in full. A badge has a `title` (the hover) and an `aria-label`. One button around the row opens the full step list in place, so a tap works on a phone. An old turn with no steps shows `answerText`, as now.
6. The live state keeps a step list per running session in place of the `streaming` string. The running answer shows the badges and the last message only.
7. `TasksPanel` becomes `ChatPanel` (the side panel "This chat"): the chat details, the context and cost, then the background tasks. On a phone, an "Info" button in the chat header opens the same content in a dialog.
8. The activity chip ("1 command, 1 tool") stays. The badge row does not replace the counts for an old turn.

## Steps

1. Core: store the steps, usage and cost of each turn (TDD in `session-manager.test.ts` and `session-store.test.ts`).
2. Web: `turn-steps.ts` with unit tests.
3. Web: live steps in `App.tsx`, and the badge row and last message in `Conversation.tsx`, with styles.
4. Web: the chat panel and the phone dialog.
5. E2E tests in `test/e2e/web-ui.spec.ts`.
6. Delete this plan.
