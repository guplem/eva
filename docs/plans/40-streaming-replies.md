# Plan: stream replies as they come (#40)

This is the working plan for #40. The last commit of the PR deletes it.

## Goal

The person starts to read an answer while the agent still works. This holds in every front end: web, Telegram and the terminal.

## What happens today

- The Claude Code adapter keeps every event of a turn in memory until the turn ends (`runOnce` in `claude-code-adapter.ts`). It does this so that it can retry a lost history before anything is shown (lesson 46). So nothing streams for Claude Code, not even a finished text block.
- The pi adapter sends a `text` event at each `message_end`. So pi streams one answer block at a time.
- The web app and the terminal already show each `text` event when it arrives.
- The Telegram bot keeps all text until the turn ends, and then sends it. It does this so that it reads the file markers from the whole answer (lesson 124).

## Steps

1. Claude Code adapter: send each event when it arrives. Keep the events only until the first event that can be shown. A lost history fails before any output, so the retry still works.
2. Telegram: send each finished text block when it arrives, not at the end of the turn. Read the file markers in each block.
3. Decide about word-by-word streaming (gap 1). If yes: add a new event kind for a piece of text, map it in both engines, and show it in each front end.
4. Update the user guide where it describes how answers arrive.

## Gaps

1. Is a finished text block enough, or must Eva stream word by word? Word by word needs a new event kind, which is a stored and sent name (a schema).
2. In Telegram, how does Eva show a block while it grows? Options: edit one message, or Telegram's draft message, or send each finished block only. Telegram limits edits per chat.
3. Can a file marker span two text blocks? If yes, a per-block read could show half a marker.
4. Does the session record or the turn record change? Today `answerText` joins the blocks with a blank line.

## Decisions

Three review agents read the code for each gap. They agree on the points below.

1. **Word by word: needs the owner.** Finished blocks meet most of the issue. A long final answer with no tool call still arrives at once. Word by word costs:
   - A new event kind (a schema change).
   - A hold-back buffer in the core. The `Redactor` reads one string at a time, so a secret cut across two pieces would pass unredacted.
   - New code in every front end. Telegram must edit a growing message, which hits the edit limits and half-written Markdown.
2. **Telegram: send each finished block as its own message,** through `sendAnswer`. Run the sends of one chat in order, because `onEvent` runs unawaited.
3. **Markers: read them per block.** A marker is one whole line, and a block holds whole lines. Attach each file with its block. Keep the offers until the turn end, so that attach still wins over offer. Send each file once per answer.
4. **Record: no change.** Blocks still arrive whole and in order.
5. **Claude Code adapter:** a lost history fails with the first and only message (`test/fixtures/claude-code/missing-session.jsonl`). Check only the first event for the retry.
6. **Guide: no change.** `docs/guide/` says nothing about how answers arrive.

## Found on the way

- The web app clears the streamed text when the page becomes visible again (`recover` in `App.tsx`). On a phone, the blocks already shown vanish until the turn ends.
