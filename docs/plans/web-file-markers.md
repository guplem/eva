# Plan: file markers in the web chat (#581)

## Motivation

The agent sends a file with a marker line: `[[attach: <path>]]` or `[[offer: <path>]]`.
Only Telegram reads the markers. The web chat shows them as text, so the person gets no file.
Eva works from a phone, and the web app is a front end like Telegram. The same answer must give the same file in both.

## Steps

1. Move `extractFileMarkers` and `FileMarkers` from `src/core/files/vault-files.ts` to `src/shared/file-markers.ts`. The web client cannot import `src/core/`, because that file imports `node:fs`. Move its tests to `test/unit/shared/file-markers.test.ts`.
2. In `AnswerBody` (`src/frontends/web/client/Conversation.tsx`), read the markers of the shown text. Render the text without the marker lines. Copy also takes the text without them.
3. Under the answer text, show one download button for each `attach` and `offer` path, with the file name. Reuse the download of the file explorer (`DownloadButton` and `useDownload` in `FilesView.tsx`, which call `GET /api/files/download`).

## Gaps

- **Where the shared download button lives.** Open.
- **What a step line in the fold shows for a message with a marker.** Open.
- **Whether a live, streaming answer shows the buttons.** Open.
- **What the button shows on a phone,** where the file explorer hides the label. Open.
