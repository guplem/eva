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

1. The wrap choice is page state in `FilesView`, as `large` is. So it stays while the person opens other files. It adds no setting ("keep settings few"). The default is on, because a phone is the main reason for the change. Two of three researchers chose on.
2. The bar keeps the size, the "Saved" status, "Edit" or the read-only note, "Cancel" and "Save", and the "More actions" button. The menu holds plain or formatted, wrap, download, and large or small. The person asked to move "Show formatted" too.
3. A `useDownload` hook holds the download state. `DownloadButton` and `FilePreview` both use it. `FilePreview` shows the `ProgressBar` and the error under the bar.
4. The wrap item shows outside the editor, when a `pre.files-text` shows: plain text, code, JSON, and Markdown with front matter. A text area wraps already.
5. A menu item swaps its label, as "Show plain text" and "Show formatted" do: "Wrap long lines" and "Do not wrap long lines". No checkbox item exists.
6. `MoreMenu` moves to `Menu.tsx` with a `label` prop and an optional `toggle` ref. The large item shows only where the large button showed: not on a phone, and not in the one folder view. The CSS that hid the button goes.
