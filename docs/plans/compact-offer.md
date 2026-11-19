# Plan: name the summary action "Compact", and offer it when the chat is nearly full (#969)

## Goal

Two changes to the web app, in one PR.

1. The "More actions" menu names the action with the word that people look for: "Compact".
2. Eva offers the action in the chat when the context window is nearly full, with a button that opens the same question.

## What exists

- `ChatHeader.tsx:168` puts the menu item. `SummaryChatQuestion` (same file, near line 420) asks the question and calls `api.summaryChat`, which posts to `/api/sessions/<id>/summary-chat`.
- `latestContext` and `contextShare` in `chat-details.ts` give the share of the context window in use.
- `Conversation.tsx` shows the usage-limit notice and the closed-chat callout over the message box.
- `composer-height.ts` is the pattern for a choice that one browser keeps: pure parse functions, and read and write wrappers in `try`.

## Decisions

- **The notice reads the branch in view, not the tree.** `latestContext(tree)` takes the newest turn of every fork by time, so a long fork would light the notice on a short branch, and the button would summarize that short branch. The notice passes only the shown session.
- **The share is 75% or more.** Below it the chat still has room.
- **An unknown window, or a newest answer with no token count, shows no notice.** Eva never guesses a share.
- **"Not now" keeps the share at which the person said it.** The notice comes back when the share grows by 10 points or more. So a chat dismissed at 76% offers again at 86%, and one dismissal does not silence a chat that later fills up.
- **The key is the shown branch id,** because each branch fills at its own speed. Blocked storage shows the notice, and never throws.
- **The dialog carries the word too.** Its heading and its label become "Compact: start a new chat from a summary?", so the word that the person tapped is the word that the question repeats.
- **Assistant chats and Project chats both get the notice.** It is a front-end notice, so Project mode stays a clean wrapper.
- **A closed chat shows no notice.** It has no message box and its own callout says what to do.
- **The dialog becomes a shared component.** `SummaryChatQuestion` moves to its own file, and the header and the conversation both use it. `useEscape` moves to `back-layer-hook.ts`, which already holds the Back layer hook.

## Steps

1. **`chat-details.ts`:** add `fullContextShare = 75` and `contextIsFull(context)`. Unit test at 74, 75, 100, a null window and null tokens.
2. **`summary-offer.ts`:** pure `offerAgain(stored, share)` plus `readHiddenShare(chatId)` and `hideSummaryOffer(chatId, share)` in `try`. Unit test the pure part.
3. **Move `SummaryChatQuestion`** to `SummaryChatQuestion.tsx`, and `useEscape` to `back-layer-hook.ts`. Rename the heading and the label.
4. **Rename the menu item** in `ChatHeader.tsx:168` and its file comment.
5. **`Conversation.tsx`:** show the notice over the message box when the branch is full, the chat is open and the person did not hide it. Its button opens the dialog. "Not now" hides it.
6. **Style** the notice with the shared `callout` class, so no new component solves the same problem.
7. **Tests:** `FakeEngine.answer` takes an optional context, `serve-demo.ts` answers a scripted message with a full context, and the e2e test checks the notice, the dialog and "Not now" after a reload. Update the two `chooseFromMore` calls in `web-ui.spec.ts`.
8. **Docs:** `docs/guide/reference.md:304` names the new label, the notice, the share and how "Not now" works.

## Gaps

None open. Each one above is settled by the code or by a rule in `AGENTS.md`.
