# Plan: unread chats (#381)

## Motivation

A person sends a message, opens another chat, and comes back later. The chat list does not show which chats have a new answer. The person must open each chat to find out.

## Design

- Each session record keeps `seenTurns`: how many of its turns the person saw in the web app.
- A session is unread when it has more turns than `seenTurns`. A turn is stored only when it ends, so a running turn never counts.
- A chat in the list is unread when any session of its tree (the chat and its forks) is unread.
- The record lives in `state/sessions.json` on the machine of the instance. Every device talks to that one core, so the mark reaches every device. The vault is not involved.

## Decisions

- **Old records:** a record with no `seenTurns` reads as "every turn seen". A schema transform fills it in, so no migration is necessary and no old chat shows as unread.
- **Bad value:** a bad `seenTurns` costs only the mark, never the session (lesson 69).
- **Who marks a chat as seen:** only the web app, because it is the only front end with a chat list. The web app marks the open chat as seen while the page is in view.
- **Race with a new turn:** the web app sends the turn count that it saw. The core never moves `seenTurns` back, and never past the stored turns. So a turn that ends during the request stays unread.
- **Other devices:** the core emits a `session_seen` event. The web app fetches the list again, so the mark goes away on every device.
- **State order:** "Needs you" wins over "Working", and "Working" wins over "Unread".
- **Look:** an "Unread" status pill with the `--accent` dot, no glow. The preview line of an unread chat shows in `--ink`, so the state shows with a word and a shape, not with colour alone.
- **Telegram:** out of scope. An answer that Telegram delivered still shows as unread in the web app.
- **App badge on the phone icon:** out of scope; #360 adds the service worker that would own it.

## Steps

1. Core: `seenTurns` in the schema, `markSeen` in `SessionManager`, the `session_seen` event.
2. API: `POST /api/sessions/<id>/seen` with `{ turnCount }`.
3. Web: the `unread` chat state, the pill, the mark on open, and the refresh on `session_seen`.
4. Project chats: the same mark.
