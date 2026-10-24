# Plan: start a new chat from a summary of another chat (#522)

## Motivation

A closed or long chat cannot go on well. The person wants to ask more without explaining the context again. The action writes a summary of the old chat and opens a new chat with it as the first message.

## Steps

1. Core: a `ChatSummarizer` in `src/core/sessions/chat-summary.ts`. It asks one model call for a summary of a chat: the goal, what was done, what is left, and the branches and files.
2. Core: two new session record fields, both with a default, so an old record reads well:
   - `continuedFrom`: the id of the chat that this chat continues, or null.
   - `firstMessageDraft`: the summary, as the first message to edit before it goes, or null.
3. Core: `Eva.continueFromSummary(sessionId)`. It reads the git state of a Project chat's clone, asks for the summary, opens the new chat, and links it.
4. API: `POST /api/sessions/<id>/summary-chat`. It answers with the new chat and the reason of a failed summary.
5. Web: "Start a new chat from a summary" in the More menu of each chat. A dialog shows the wait. The page then opens the new chat.
6. Web: the composer of a chat with no turns starts with `firstMessageDraft`.
7. Web: the chat details show "Continues" in the new chat and "Continued in" in the old chat, each with a link.

## Gaps and decisions

- **#521 is not merged.** Its PR holds only a plan. Decision: a Project chat goes on through `ProjectWork.createSession`, with no clone name. That path picks the clone today. When #521 changes the rule, this action follows it with no change.
- **Which model writes the summary?** Decision: the cheapest model of the chat's engine (`cheapestModel`), as the chat names and commit messages do.
- **How much history goes to the model?** Decision: the newest turns, up to 40,000 characters in all, and each text cut to 4,000 characters. A long chat keeps its end, where the open work is.
- **What git state goes to the model?** Decision: `git status --porcelain=v1 --branch` and the last 10 commits of `git log --oneline`, from the clone of the old chat. A failed read leaves the state out.
- **Where does the old-to-new link live?** Decision: only the new chat stores `continuedFrom`. The web app finds the chats that continue a chat in the chat list. One fact has one home.
- **Engine, model and effort of the new chat.** Decision: the same as the old chat.
- **Failure.** A failed summary still opens the new chat, with the link and an empty first message. The API returns the reason, and the web app shows it in a toast. A failed chat creation, such as a missing project, is an error.
- **Telegram.** Not in this change (assumption 1 of the issue).
