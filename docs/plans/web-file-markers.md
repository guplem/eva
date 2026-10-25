# Plan: file markers in the web chat (#581)

## Motivation

The agent sends a file with a marker line: `[[attach: <path>]]` or `[[offer: <path>]]`.
Only Telegram reads the markers. The web chat shows them as text, so the person gets no file.
Eva works from a phone, and the web app is a front end like Telegram. The same answer must give the same file in both.

## Steps

1. Move `extractFileMarkers` and `FileMarkers` from `src/core/files/vault-files.ts` to `src/shared/file-markers.ts`. The web client cannot import `src/core/`, because that file imports `node:fs`. Move its tests to `test/unit/shared/file-markers.test.ts`.
2. In `AnswerBody` (`src/frontends/web/client/Conversation.tsx`), read the markers of the whole answer. Render the text without the marker lines. Copy also takes the text without them. The folded step lines and the live answer hide them too.
3. Update the "Sending files" part of the assistant prompt.
4. Under the answer text, show one download button for each `attach` and `offer` path, with the file name. Reuse the download of the file explorer (`DownloadButton` and `useDownload` in `FilesView.tsx`, which call `GET /api/files/download`).

## Decisions

Three sub-agents answered each gap. All three gave the same answers.

- **Where the shared download button lives.** Move `useDownload`, `DownloadWait` and `DownloadButton` from `FilesView.tsx` to `client/DownloadButton.tsx`, as `SaveButton.tsx` is shared. Extend `DownloadButton` with an optional `label`: the chat passes the file name. A chat button keeps its name on a phone, because the hidden explorer label only makes room for the path.
- **Which text the buttons read.** Read the markers of the whole answer, as Telegram reads every block of a turn. Remove the marker lines from the shown text, from the copied text and from each folded step line. A step keeps 200 characters, so also hide a last line that starts a marker.
- **The live answer.** Show no buttons while the turn runs: the file can still change, and Telegram also waits for the turn end. Hide complete markers and a half-written last line. The buttons come with the stored turn, with Copy and Retry.
- **The checks.** Use `GET /api/files/download` as it is. Telegram's stricter rules exist because a sent file goes to Telegram's servers (lesson 72). The web button sends the file to the person's own device, and the explorer already downloads the same files. A folder gives a zip.
- **The prompt.** Say that Telegram and the web app read the markers, and that the web app shows a download button for both.

## Rejected review findings

- **A Project chat reads markers against the vault, not the clone.** Telegram already reads markers in every mode, so the web does the same. A project harness gets no Eva prompt, so it seldom writes a marker. A change for both front ends is a separate issue.
- **A code fence left open in one message hides a marker in the next.** The buttons read the whole answer, because stored steps keep only 200 characters. An open fence across messages is rare.
- **A folder marker shows "Downloading…" instead of "Packing the folder…".** The chat cannot know that a path is a folder before the download. The zip still arrives.
