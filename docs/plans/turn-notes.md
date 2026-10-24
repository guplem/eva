# Keep a turn's notes after the turn ends (issue 157)

## Motivation

The web app shows a notice, such as an MCP server that did not start, only from the live event stream. A reload loses it. A lost history shows as a live message step, and the turn end deletes it. On a phone, the person can miss why the assistant had no calendar (#133). Telegram keeps both notes in the chat, so the gap is in the web app only.

## Decisions

- **Store the notes in a new turn field, `notes: string[]`, not in a new step kind.** An older Eva reads an unknown step kind as a bad step list and drops every step of that turn. An older Eva ignores an unknown turn field. The read uses `.catch([])`, so a record from before the field, or a bad value, has no notes.
- **The core collects the notes of a turn** from the engine stream: each `notice` text, and a fixed text for `history_lost`. It keeps each text once. Both `recordTurn` and `recordFailure` store them.
- **The wait notice for a busy clone stays live only.** It tells why the turn has not started. The turn then starts, so the note has no value later.
- **The web app shows a stored turn's notes below its answer,** with the `turn-note` style that the live notes use.
- **A live lost history becomes a live note, not a message step.** So the live answer and the "whole answer" view never hold it, like the stored turn.
- **The live notes of a chat end with its turn,** because the stored turn now shows them. The wait notice ends there too.
- **The answer text and the step list do not change.** The notes are not steps, so `answerText` and the "whole answer" view exclude them.

## Gaps

None open.
