# Plan: the home page, a blank New chat page, and a menu with every page (#1037)

Built on the branch of #1036, which is not merged yet.

## Changes

1. `navigation.ts`: add the destination `home`, at `#/home`. `homeAddress` becomes `#/home`. The visor is the current button on `home`. `currentNavButton` loses its `homeShown` argument.
2. `App.tsx`: the screen `home` shows the home page. A message sent there makes a chat, then opens it in Chats. The `homeShown` state goes.
3. `NewChatDraft.tsx`: one component for both pages, with a `home` flag.
   - Home: no title on screen, the greeting, the widgets, the bell, the gear and the widget layout button. On a phone, a ☰ menu at the top left lists every page.
   - New chat: the title "New chat" and the engine line, the ☰ of the chat list, the missing setup step, and the message box. No greeting and no widgets.
4. `new-chat-text.ts`: a widget's text stays on the home page. A project mention opens the New chat page.
5. The menu uses `MenuButton` from `Menu.tsx`. Its order is `rowOrder(choice, "phone")`: the tabs first, then the other pages.
6. Tests: unit tests for `navigation.ts`, e2e tests for the home page, the menu and the New chat page. Existing e2e tests that open the home page move to `#/home`.
7. Docs: `docs/guide/reference.md`, `docs/design/eve/README.md` and the captures.

## Gaps

None open. The issue lists the decisions of the person and the assumptions.
