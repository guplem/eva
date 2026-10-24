# Plan: web chat view and message box (#506)

## Motivation

Eva works from a phone. A chat that jumps while the person reads, or loses what they typed, breaks that goal.

## Changes

1. **Scroll.** Add a pure rule in `conversation-parts.ts` that takes the last scroll top and the new scroll position. A move up stops the follow. Only a position inside the threshold starts it again. `Conversation.tsx` keeps the last scroll top in a ref.
2. **Queued message.** Keep a list of sent messages, not one. Each message keeps the turn count after which its own turn is stored. A message sent while a turn runs waits for one more stored turn. `shownPending` shows each message while the stored turn count is at most its count. The effect drops a message only when the count passes it.
3. **Markdown memo.** `AnswerBody` computes `toWebHtml(body)` in `useMemo`.
4. **IME.** The Enter handler ignores a key while `event.nativeEvent.isComposing` is true.
5. **Unsent text.** A new module `unsent-texts.ts` keeps the unsent text of each chat in `sessionStorage`, with each access in try/catch. It falls back to memory when the storage fails.
6. **Failed send.** A pure rule gives the text to put back: the old message when the box is empty, or the old message and the new text joined by a blank line.
7. **New chat.** A ref guards `newChat`, so a second tap during the first create does nothing.
8. **Screen reader.** The streaming body loses `aria-live`. The working line already announces nothing. One polite live region says "Eva answered." once, at the end of a turn.

## Gaps and decisions

- **Running turn signal for item 2.** `working` is also true while a sent message waits for its turn to start. Eva gathers messages sent before the turn starts into one turn. Decision: use the live steps (a turn has started) to choose one more stored turn, not `working`.
- **Item 7: guard or draft page.** Opening the New chat draft would change what the e2e tests expect from the button, and this group cannot run the e2e tests. Decision: a busy guard. The button keeps its behavior.
- **Item 8: where to announce.** Decision: a visually hidden `role="status"` line in `Branch`, filled when the live steps of the shown chat end.
- **Sub-agents.** This agent cannot start sub-agents, so it did the gap research and the reviews itself.
