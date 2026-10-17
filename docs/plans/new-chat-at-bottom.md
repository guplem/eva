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
   - the model menu sits above the button, with a gap of at least 8 px;
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

To fill after the gap review.
