# Plan: rename a chat from any front end (issue 46)

This is a working plan. Delete it before the merge.

## Goal

The person renames a chat from the web page, Telegram or the terminal. Every front end shows the new title. A chat with its own Telegram topic also renames the topic. The title is in `state/sessions.json`, so it survives a restart.

## Steps

1. **Core.** Add `SessionManager.rename(sessionId, title)`.
   - Clean the title: join the lines with spaces, trim it, and cut it to 60 characters, as `titleOf` does.
   - Refuse an empty title with a new `EvaErrorCode` value, `title_invalid`.
   - Save the record, then emit a new event, `session_renamed`, with the new title.
   - A rename does not wait for a running turn: `recordTurn` and `recordFailure` read the record again, so they keep the new title.
   - A renamed chat keeps its title after its first message: `recordTurn` names only a chat whose title is still "New chat".
2. **Event.** Add `{ kind: "session_renamed"; title }` to `EngineEventPayload` in `src/shared/events.ts`. Redact the title, as the core redacts every other text.
3. **Local API.** Add `POST /api/sessions/<id>/rename` with `{ title }`. Map `title_invalid` to 400.
4. **Web page.** Add a rename button next to the chat title in the Assistant view. It opens a small form in place of the title. On the `session_renamed` event, the page loads the session list again.
5. **Telegram.**
   - Add `/rename <title>`: it renames the chat of the topic or of the main chat.
   - On `session_renamed`, call `editForumTopic` when the chat has its own topic (`telegramTopicId` is not null). A schedule topic holds many runs, so a rename of one run leaves the topic name.
   - Mark the topic entry as renamed, so the first message does not rename the topic again.
6. **Terminal.** Add `/rename <title>` to `eva chat`.
7. **Docs.** Add the commands to `docs/guide/` where the other chat commands are.

## Decisions

- One event for every front end, not a call from the core to Telegram: the bot already reacts to session events, and the web page too.
- The `rename` route is a POST action, as `fork`, `stop` and `retry` are.
- Project chats show the project and clone name in the web header, not the chat title. So the web rename is in the Assistant view only. Telegram and the terminal rename any chat.
