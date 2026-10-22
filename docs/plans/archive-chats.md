# Plan: archive chats (issue 388)

The person wants to clear the chat list without losing old chats.

## Decisions

- **Store:** a new `archived` boolean on the session record, in `state/sessions.json`. A record without the field, or with a bad value, reads as not archived. No migration is needed.
- **Scope of the flag:** the web app archives the root chat. Its forks follow the root, because the list shows root chats only.
- **Core:** `SessionManager.setArchived(sessionId, archived)` saves the flag and emits a `session_archived` event. Every device then fetches the list again.
- **New message:** `send` clears the flag on the root of the chat. A new answer must not hide in the archive.
- **API:** `POST /api/sessions/:id/archive` with `{ archived: boolean }`, like `rename` and `seen`.
- **Telegram and the terminal:** they ignore the event. Neither has a chat list.
- **Web app, assistant mode only:** project chats live in clone cards, and stay as they are (assumption in the issue).
  - The list context menu and the "More actions" menu get "Archive", or "Unarchive" for an archived chat.
  - The bottom of the chat list has an "Archived chats" button with the count. It switches the sidebar to the archived chats, with a back button. Search works in both lists.
  - A link to an archived chat opens the archived list.

## Gaps

None open. Each decision follows the pattern of `seenTurns` (issue 381) and `rename` (issue 46).
