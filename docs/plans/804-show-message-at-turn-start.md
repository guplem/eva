# Plan: show the message of a turn when the turn starts (#804)

## Goal

The web chat shows the message of a turn as soon as Eva starts the turn, whatever sent it. It looks exactly as the stored turn will look, so nothing changes at the turn end.

## Design

1. **The core says what each turn shows, once, at the turn start.** `drain` builds a `TurnMessage` for the batch: `userText` (the joined texts, as the stored turn has them), the `TurnSender` fields (`fromEva`, `personText`, `projectReports`), `turnIndex` (the stored turn count at the start) and `clientIds`. It emits a new core event `turn_started` with it. `message_received` stays as it is, for Telegram and the alerts.
2. **The snapshot holds it.** `runningTurns()` lists each chat with a running message, also before the engine sends a step. Each entry gets an optional `message`. `forgetRunningTurn` clears it.
3. **The page sends an id with its own messages.** `api.send` adds a random `id`. The API passes it as `clientId` to the batch, and the core echoes it in `clientIds`. An older core ignores the field.
4. **The page keeps the running message by chat id** in `live-state.ts` (`messages`), from the event and from the snapshot. The Settings cards send before the chat page opens, so the state must live in `App`.
5. **`Conversation.tsx` draws the running message with the same parts as a stored turn**: the project report cards and one `UserMessage` from `personWords`. It shows it while the chat works and while `turnIndex` equals the stored turn count. It hides each own pending message whose id the running message holds.

## Gaps and decisions

The owner is away. Each decision is what he would choose: simple, no new settings, nothing lost.

- **A new event kind or a new field on `message_received`?** A new kind, `turn_started`. A batch has many messages but one turn view, and the stored turn is built from the whole batch. Front ends that do not know the kind ignore it: Telegram, the terminal and the alerts get explicit no-op cases.
- **How the page knows its own message.** By an id that it sends, not by text: the core redacts the text, and another tab sends the same origin. The issue asks for this.
- **When the running message leaves.** It shows only while `turnIndex` equals the stored turn count. So it leaves when the stored turn arrives, failed or stopped too, with no blink between `turn_finished` and the list reload. A later turn replaces it.
- **A follow-up turn of the mode.** It has no person message. Its stored turn shows its text as "Sent by Eva", so the running turn shows the same.
- **An older core.** No `turn_started` and no `message` in the snapshot: the page behaves as today.
- **Stored and sent names.** `turn_started` is a new event `kind`, `message` a new optional snapshot field, `id` a new optional API field. All are additions, read tolerantly. Nothing is breaking, and no migration is needed.

## Tests

- Unit, core: `turn_started` carries the joined text, the sender, the report and the client ids, redacted. The snapshot lists a chat with a message before its first step, and forgets it after the turn.
- Unit, web: `live-state.ts` keeps the message from the event and from the snapshot; a pure helper picks which pending messages to hide.
- Unit, API: the send route passes the id on.
- E2E: a message sent outside the page (a direct API send) shows in the open chat while its turn runs, once.
