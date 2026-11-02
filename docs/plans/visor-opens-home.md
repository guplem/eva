# A tap on the visor opens the home page (#761)

## Motivation

The person sees the visor as the most natural way to reach the widgets. Today the visor opens the notification center (#566). After this change, it opens the new chat page, which shows Eva and the widgets. The notification center opens from a bell at the top right of that page.

## Changes

1. `navigation.ts`: add `homeAddress` (`#/chats/new`) and a function that names the current button of the main navigation. On the home page, the visor is the current button, and Chats is not.
2. `nav-visor.ts`: add the accessible name of the bell, made from the same `visorSignal` as the visor.
3. `App.tsx`: compute the signal once and give it to the visor and the bell. A tap on the visor opens `homeAddress`. `AssistantView` tells `App` when the new chat page shows.
4. `MainNav.tsx`: the visor calls `onHome` and is current on the home page. A new `HomeButtons` component shows the bell, and a gear on a phone only.
5. `NewChatDraft.tsx`: show `HomeButtons` at the right of the header.
6. e2e tests: the visor opens the new chat page. The bell opens the center. On a phone, the gear opens Settings.
7. Docs: `README.md`, `docs/guide/reference.md` and `docs/design/eve/README.md` say that the bell opens the center. Capture the `new` page again.

## Gaps

No gap is open. The person confirmed each assumption of the issue:

- The bell shows the same count and dot as the visor.
- A computer keeps Settings at the foot of the rail, so the home page shows only the bell there. A phone shows the bell and a gear.
- A tap on the visor during a chat opens a new chat page. The chat stays in the list.
- `#/notifications` keeps working. The center keeps its Settings button. The visor is current on the home page. The tap still plays a random face.
