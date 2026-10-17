# Plan: the new chat controls at the bottom of the sidebar

Issue #38.

## Goal

In Assistant mode, the sidebar shows the chat list first.
The model menu and the "New chat" button sit at the bottom of the sidebar.
A clear space separates the model menu from the button.

## Why

- The chat list is what the person reads most. It belongs at the top.
- A thumb reaches the bottom of a phone screen more easily. Eva works from a phone.
- Today the label text, the menu and the button touch, so they read as one block.

## Steps

1. Add a failing browser test (`test/e2e/web-ui.spec.ts`) at both sizes:
   - the "New chat" button ends at the bottom of the sidebar, below the last chat;
   - the model menu sits above the button, with a gap of at least 16 px;
   - the controls stay visible when the chat list is longer than the screen.
2. Split the sidebar into a list part that scrolls and a footer that stays.
   - Put the model menu and the "New chat" button in the footer.
   - Keep the model menu above the button: the model comes first (lesson 41).
   - Stack the label text above the menu, as the Settings page does.
3. Run `bun run check` and the browser tests.

## Gaps

- **Order inside the footer.** The issue names "new chat" first, then the menu.
- **Scope.** Does Project mode change too? Its sidebar has no "New chat" button.
- **Test style.** No unit tests cover the web client. Only the browser tests do.

## Decisions

Three review agents agreed on each gap. No gap needs the owner.

- **Order.** The model menu sits above the button, and the button sits last.
  Lesson 41 says the model choice comes first.
  The issue only lists the two controls. It sets no order.
  The last place is also the easiest for a thumb.
- **Scope.** Assistant mode only.
  Project mode has no "New chat" button and no model menu.
  Its search box and status filter belong above the list that they filter.
  `.sidebar` is shared, so the split uses new classes that only Assistant mode uses.
- **Test style.** Playwright tests with `boundingBox()`, as the composer test does.
  The gap is already 8 px, so the test asks for 16 px. Otherwise it cannot fail first.
  A short window makes the list longer than the screen. Chats pile up across tests, so the test counts on no fixed number.
- **Phone.** The footer gets a bottom padding of `env(safe-area-inset-bottom)`, as the composer does.
- **Names.** The label "Model for a new chat" and the button "New chat" stay. Many tests find them by that text.
- **Docs.** `docs/guide/` and `README.md` never describe the sidebar. They need no change.
- **Screenshot.** The issue's image cannot be opened here. The issue text is the spec.
