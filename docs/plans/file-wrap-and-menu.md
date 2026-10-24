# Plan: wrap long lines, and a "More actions" menu in the file bar

Issue: #484.

## Motivation

The person reads vault files on a phone. Plain text and code keep each line, so a long line runs off the screen. The file bar also holds too many buttons for a phone.

## Changes

1. Add a wrap choice for plain text and code in `FilePreview` (`src/frontends/web/client/FilesView.tsx`). A class on `.files-text` sets `white-space: pre-wrap`.
2. Add a "More actions" menu to the file bar. Reuse `MenuList` and `useDismissOutside` from `Menu.tsx`, as the chat header does.
3. Update the e2e tests in `test/e2e/web-ui.spec.ts` that click the moved buttons.

## Gaps

1. Is the wrap choice page state, or a stored choice? What is its default?
2. Which actions stay in the bar, and which move to the menu?
3. How does the download show its progress and its error from a menu item?
4. When does the menu show the wrap item?
5. How does a menu item show an on or off state?
6. How is the "More actions" button shared between the chat header and the file bar?

## Decisions

Filled in after the research.
