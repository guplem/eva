# Plan: stream replies word by word (#117)

## Motivation

#40 shows each finished text block at once. A long final answer with no tool call still arrives as one piece, after a long wait. On a phone, the person sees only "Working" for that time. Streaming the words shows progress, and the person can start to read early.

## Design

- **Event.** A new engine event kind, `text_delta` (`{ kind, text }`), on the engine port. The core sends it but never stores it: it adds no step, no answer text and no count. The final `text` event stays the source for the record, Telegram and file markers. It is a schema change (a new sent `kind`), so the PR says so. It is not breaking: an old client ignores an unknown kind.
- **Claude Code.** Set `includePartialMessages: true` in assistant and project mode only. A model call has no front end to stream to. Map each `stream_event` with a `content_block_delta` of type `text_delta` to `text_delta`. Skip it when `parent_tool_use_id` is set (a subagent).
- **pi.** Map each `message_update` record whose `assistantMessageEvent.type` is `text_delta` to `text_delta`.
- **Redaction.** A new `TextStreamRedactor` in `src/shared/redaction.ts`. It keeps the raw text of the current block and redacts all of it at each piece. It sends only up to the last whitespace, and holds back the length of the longest known secret. A token shape has no whitespace, so a held-back word is never half a secret. If a later piece changes text that was already sent (for example, a private key header), the stream of that block stops, and the final `text` shows the answer.
- **Block end.** The draft is the text since the last `text` event of the turn. The core and each front end reset it at `text` and at the turn end.
- **Web.** `LiveState` gets `drafts` by session id. `LiveAnswer` shows the draft as the last message, through the same `AnswerBody`.
- **Terminal.** `eva chat` writes each piece. At the `text` event it writes only the rest of the block, or the whole block again on a new line when the draft does not match.
- **Telegram.** Ignores `text_delta`.

## Gaps

1. Does `includePartialMessages` change what a project session does, against "project mode is a transparent wrapper"? Decision: no. It changes only what the SDK reports to Eva, not the prompt, the skills or the settings.
2. Is a `text_delta` message id needed to match the final `text`? Decision: no. Each engine sends a block's pieces and then its `text`, so "since the last `text`" is enough.
3. Must the web keep a draft across a reload? Decision: no. The draft is live only. #118 covers a phone that comes back.
4. Cost of redacting the whole block at each piece. Decision: accept it. A block is a few thousand characters.
