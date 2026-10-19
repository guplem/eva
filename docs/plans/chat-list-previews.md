# Plan: previews, times and states in the chat list (issue 169)

## Motivation

The chat list shows a title and a source only. On a phone, the person cannot see which chat runs or which chat waits for an approval. Part of the EVE redesign (issue 161). See the chat list in `docs/design/eve/reference.html`.

## Gaps and decisions

1. **Where does the preview come from?** The session list already holds every turn with its `answerText`, `failure` and `userText`. Decision: the client takes the last turn of the root chat. No API change.
2. **Where does "Needs you" come from?** `App.tsx` already keeps the pending approvals, from `/api/approvals` and the events. Decision: pass them to `AssistantView`. An approval of a fork marks its root chat.
3. **Where does "Working" come from?** `live.steps` has a key while a turn runs. A reload or a reconnect clears it, so a quiet turn shows no state until its next event. Decision: add `running: boolean` to each session in `GET /api/sessions`, from `SessionManager.isBusy`. A chat works when the list or `live.steps` says so. This is a new sent field, not a stored one.
4. **Groups.** "Today" (the same local day), "This week" (the 6 days before), "Older".
5. **Time.** Today: `HH:MM`. This week: the short weekday. Older: the day and the short month.
6. **Search.** A case-insensitive filter on the title. No match shows "No chat matches."
7. **Header.** "Chats" and a "New" main button. Its accessible name stays "New chat". The clock button that opens Schedules moves into the header.
8. **Model picker.** The composer issue is not built, so the select stays in the list footer.
9. **Selected item.** A panel card with a shadow, as `.ci.on` in the reference.
10. **Schedule chats** keep the clock icon before the title.
11. **Tests.** The pure parts (group, time, preview, state, filter) go in `client/chat-list.ts`, with unit tests. The e2e test of the footer layout changes: the New button is now at the top.
