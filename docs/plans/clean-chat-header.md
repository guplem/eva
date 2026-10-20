# A clean chat header (issue 207)

## Why

The chat header holds every action in a row: a pencil, a model badge, "Chat info" and a red "Delete chat".
On a phone they wrap to a second row. The EVE reference shows a title, one subtitle line and a "more" button.

## What changes

- A new `ChatHeader` component in `client/ChatHeader.tsx`. Assistant chats and project chats both use it.
- The header holds: the list button (phone), the title with its subtitle, any extra parts (the PR pill and the mode chip of a project chat), and a "More actions" button.
- The "More actions" menu holds Rename, Chat info (phone only) and Delete chat.
- Rename turns the title into the field that the pencil opened before.
- Delete chat asks in the page, under the header row, as a schedule row does. No `window.confirm`.
- On a phone, a tap on the title opens the chat details sheet.
- The assistant subtitle is the engine and the mode, such as "Claude Code · Assistant". While a turn runs, it starts with "Working".
- The project subtitle keeps its crumbs: project, clone and branch.
- The header badge and the "Model for a new chat" select go. A new assistant chat starts with the default model, as a project chat does. The composer chip changes it before the first message.

## Gaps and decisions

- **Scope: project chats too?** Yes. `DeleteChatButton` and `ChatInfoButton` serve both views, so both get the same header. Project chats also get Rename: the rename API takes any session.
- **How does the page know it is a phone?** A small `matchMedia` hook with the breakpoint of `styles.css` (760 px). The title is a button only on a phone. A button on a computer would open a sheet that the inspector already shows.
- **Menu keys.** Escape and a tap outside close the menu, as the composer chip does. The arrow keys move between the items.
- **The words of the delete question.** "Delete “title” and its forks everywhere?" with "Delete" and "Keep", as the schedules page has "Remove" and "Keep".
- **The subtitle words.** A pure function `chatSubtitle` in `client/chat-details.ts`, with a unit test.

## Tests

- Unit: `chatSubtitle`.
- End to end: update the tests that use the badge, the model select, the pencil, "Chat info" and `window.confirm`. Add a phone check that the header is one row, and that a tap on the title opens the sheet.
