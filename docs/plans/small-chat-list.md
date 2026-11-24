# Plan: a small chat list (#1046)

## Goal

`GET /api/sessions` sends only the small facts of each chat. The open chat reads its turns on its own.

## Server

- `src/frontends/api/session-list.ts`: `ListedSession` becomes the record without `turns`, plus `running`, `turnCount`, `lastTurn` and `turnsKey`.
  - `lastTurn`: the last turn with its long texts cut and no steps or notes, for the preview of the chat list. Null when the chat has no turn.
  - `turnsKey`: a short hash of the turns. The page reads a chat again only when its key changes. A note added to the last turn changes neither the count nor `lastTurnAt`, so a count is not enough.
- New route `GET /api/sessions/<id>`: the whole record, with the steps of its recent turns only, plus `running`, `turnCount` and `turnsKey`.
- Large JSON answers go out with gzip when the browser accepts it.

## Web client

- `api.sessions()` returns the small list. New `api.session(id)` reads one chat.
- A new hook reads the turns of each chat of the open tree (the chat and its forks), and keeps them by id with their key. The views merge the list's fresh facts with the kept turns.
- Until the turns of the open tree arrive, the chat shows its loading skeleton.
- The list helpers read `turnCount` and `lastTurn` instead of `turns`: unread state, preview, branch choices.

## Gaps and decisions

- A page from before this change reads a list with no turns. Decision: no migration. The page reloads itself after an update (`reloadIfStale`), so the person does nothing by hand.
- The CLI and Telegram do not read `GET /api/sessions` (checked with grep).
- Gzip reuses the accept check of #1044 when it merged, or a shared helper.
