# Plan: an unsent message of the web app survives a reload (#946)

## Goal

A reload of the page keeps each unsent message in its chat, with its state. After the reload, the page sends each one again with the same id, so none reaches Eva twice.

## Change

- `src/frontends/web/client/outbox.ts`: an optional `storage` option. Each change writes the entries as one JSON array under the key `eva-outbox`. The constructor reads the key tolerantly and restores the entries in their order.
  - A `sending` or `waiting` message comes back as `waiting` with no timer. The existing `retryNow()` sends it with the same id when the page connects. Nothing sends before the login.
  - A `failed` message stays `failed`. A `sent` message stays `sent`, and `forget()` drops it when its stored turn comes.
- `src/frontends/web/client/page-outbox.ts`: passes `() => window.sessionStorage`.
- `docs/guide/reference.md` and `docs/guide/how-eva-works.md`: the new behavior and its limits.

## Decisions

- Storage: the tab's `sessionStorage`, as `unsent-texts.ts`. Every tab shares `localStorage`, so two tabs would send and overwrite the same list.
- The first message of the New chat page, while Eva makes the chat, stays out of scope. No chat id exists yet in that short window.
- The core does not change. It runs each client id once while it runs (the newest 100 ids of each chat, in memory).

## Limits for the owner to decide

- A closed tab, or a phone that ends the page's process and opens a new one, loses the unsent messages.
- The core forgets the ids when it restarts. A message that the core took, whose answer the page lost, can run twice after a core restart. This gap exists since #945.

## Gaps

None open. The parent review decided the storage, the scope of the New chat page and the limits.
