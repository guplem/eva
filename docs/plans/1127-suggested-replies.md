# Plan: suggested replies (#1127)

Eva ends an answer with 1 to 4 `[[reply: <text>]]` lines. The web message box shows the first reply in grey, and sends it with Tab or a tap.

## Parts

1. **Parser** (`src/shared/file-markers.ts`). `extractFileMarkers` removes the reply lines from the text and gives `replies`. It applies the limits there: 60 characters and 4 replies. `shownAnswerText` hides a half-streamed `[[reply:` line.
2. **Rules of the web app** (`src/frontends/web/client/suggested-replies.ts`). Which replies a chat offers, when the box shows them, and when Tab sends one.
3. **Message box** (`Composer.tsx`). The grey reply with a send arrow, the "+N" button that opens the list, and Tab.
4. **Conversation** (`Conversation.tsx`). It gives the replies of the newest answer to the box.
5. **Prompt** (`assistant-base-prompt.md`). A short section "Suggested replies".
6. **Demo, tests and docs.** A demo turn in `test/e2e/serve-demo.ts`, unit tests, an e2e test, `docs/guide/reference.md`, `docs/guide/how-eva-works.md`, and the EVE chat captures.

## Gaps and decisions

- **Which text holds the replies?** The whole stored answer of the newest turn, as `answerFiles` reads it. The prompt asks for the lines at the end of the last message, so an earlier message rarely holds one.
- **The limits.** The parser drops an empty reply and a reply longer than 60 characters (counted in code points, so an emoji counts once). It keeps each reply once. Then it keeps the first 4. Each reply line leaves the shown text, also a dropped one. #1128 reads `extractFileMarkers(answer).replies` and gets the limits for free. `maxReplies` and `maxReplyLength` are exported for its tests.
- **A stopped turn.** The core stores a stopped turn with a `failure` (`recordFailure`), so "no failure" covers both the failed and the stopped turn.
- **When the chat offers replies.** Only an `assistant` chat. Only the last turn of the branch in view, with no failure, while no turn runs, no message waits, and no approval or question waits. A closed chat shows none.
- **When the box shows them.** The box is empty and holds no file, it is not locked, and it sends, uploads and rewrites nothing.
- **Look.** The first reply shows in grey over the empty text, where the placeholder is. A round arrow button follows it, with a "Tab" key cap on a computer. With more replies, a "+N" pill follows. The text and the buttons sit in one line, and the text ends with "…" when it is too long. The send icon keeps its one meaning: send.
- **The list.** The "+N" pill is the shared `MenuButton`, which opens above it and lists every reply. A pick sends at once. `MenuButton` gets a `keepFocus` option, so a tap keeps the phone keyboard as it is, as `keepFocus` does for the other buttons of the box.
- **The keyboard.** Tab sends only when the box has the focus, shows a reply, the mention list is closed, no input method composes, and no other modifier key is down. The suggestion buttons come before the text in the page order, so Shift+Tab from the box reaches "+N" and the arrow.
- **A screen reader.** The box keeps no placeholder while it shows a reply. A hidden line describes the box instead: "Suggested reply: <text>. Press Tab to send it."
- **The send.** The arrow, Tab and the list call the same `send` of the box, with the reply as the text. So the outbox, the message id and the send morph stay the same. A failed send puts the reply in the box as text.
- **Demo.** The words "weekend plan" start a demo answer that ends with a question and three replies. `scripts/capture-design.ts` sends them for its chat scene, so the EVE chat capture shows the grey reply.
