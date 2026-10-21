# Plan: context menus (issue #302)

A right click on a computer, or a long press on a phone, shows the quick actions of an item.

## Motivation

The chat actions live only in the header of an open chat. The person must open a chat to rename or delete it. A right click opens the browser's menu, which has no Eva action.

## Design

- `client/menu-place.ts`: a pure function that places a menu at a point, inside the screen. The tooltip has the same kind of file.
- `client/Menu.tsx`: the one menu part of the page.
  - `MenuList` draws the items with `role="menu"` and the keyboard keys. The "More actions" menu of the chat header uses it too.
  - `useContextMenu(items)` gives the props for the item and the menu to draw. A right click, the menu key, Shift+F10 and a long press open it.
- The browser keeps its own menu everywhere else, so text and fields keep copy and paste.
- `.menu` holds the look of every menu. `.more-menu` and `.context-menu` hold only the place.

## Where

- A chat in the Assistant list: Open, Rename, Delete chat.
- A chat of a clone card: Open, Rename, Delete chat.
- A project in the project list: Open, Details, Repository setup, New clone.
- The Design reference page: a sample to try.

Rename and Delete reuse the header's forms: the action opens the chat and starts the form.

## Gaps and decisions

- **Global or per item?** Per item. A global block would break copy and paste on text. (Pattern: the tooltip asks for a `data-tooltip` per element.)
- **Long press on iOS:** Safari sends no `contextmenu` event. A timer of 500 ms on a touch pointer opens the menu. A move of more than 10 px cancels it. Android sends `contextmenu`, so the hook ignores the second open.
- **The click after a long press** must not open the item. The hook drops that one click.
- **Archive:** Eva has no archive. The menu shows only the actions that exist.
