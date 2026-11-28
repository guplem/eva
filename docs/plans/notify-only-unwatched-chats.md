# Plan: notify only for a chat that nobody reads (#1136)

## Goal

- Send no notification of a chat while the person reads that chat on any device.
- Close the notification of a chat when the person opens Eva on that device and the chat is seen.

## Changes

### Core: `src/core/alerts/web-push.ts`

- A claim also says whether the person is active on the page.
- A page of a device with no subscription can claim too. Eva keeps these claims in a second map, by page id, with a limit, so a page cannot fill her memory.
- `recipients` gets the chat that the notification is about. When an active page in view shows that chat, on any device, nobody gets the push.
- The rule of the device's own page stays as it is.

### Core: `src/core/alerts/chat-notifications.ts` and `src/core/eva.ts`

- An approval names its chat too, so an active page that shows the chat holds it back on every device.

### API: `src/frontends/api/local-api.ts`

- `POST /api/push/in-view` takes no `endpoint`, or a null one, and an optional `active`. An old page sends no `active`: it reads as false, so the old behavior stays.

### Web: `src/frontends/web/client/push-presence.ts`

- The page claims with or without a push address.
- The page tracks the last input. A claim says `active` when the last input is less than 5 minutes old. The first input after a quiet time sends a claim at once.

### Web: new `src/frontends/web/client/seen-notifications.ts`

- When a fresh list of chats arrives and the page is in view, the page closes each notification with the tag `chat:<id>` whose chat is gone, or has no unseen turn and no approval that waits.

### Docs

- `docs/guide/reference.md`, "Notifications on a device".

## Gaps

None is open. The issue lists each choice as an assumption, with its source.
