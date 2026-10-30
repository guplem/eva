# Keep the unsent text of each chat on Eva (issue 652)

## Goal

A half-written message stays in its chat, and in the New chat page, on every device of the person.

## Design

- The core keeps the texts in `state/unsent-texts.json`, with `UnsentTextStore` in `src/core/sessions/unsent-texts.ts`.
  - Each entry has a key (a chat id, or `new-chat`), a text and a revision. One counter gives each write a higher revision.
  - The core redacts each text before it keeps it.
  - An empty text removes the entry, unless the write keeps the clear (a chat that starts with a summary).
  - The store keeps at most 200 entries. A full store drops the oldest entry.
  - The delete of a chat deletes its entry.
- The local API gets `GET /api/unsent-texts` and `PUT /api/unsent-texts/<key>`. Each write goes to every socket as an `unsent_text` event, with the id of the page that wrote it.
- The web app keeps its copy in the tab's session storage, as before. It also keeps the revision of the copy that Eva has. A copy with no revision has changes that Eva does not have yet.
  - A change goes to Eva after a short pause, or at once when the page hides. One write of a key runs at a time.
  - A text from Eva replaces the copy, unless the copy has changes that Eva does not have. Then the copy wins and goes to Eva. So the newest change wins, and a reload after an update loses nothing.
  - The page reads every text at each connection, so a device that slept catches up.
- The New chat page uses the key `new-chat`.

## Gaps

- Where to keep the texts: the machine's state folder. A half-written message is not knowledge, and the vault syncs through git (`AGENTS.md`: each setting has one home).
- How other devices learn of a change: the event route, as for the schedule cards.
- Redaction: the `AGENTS.md` rule redacts each text that leaves the core.
