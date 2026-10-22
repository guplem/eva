# Plan: attach files in the web chat

Issue: #409.

## Motivation

Eva works from a phone. In Telegram, the person can send a photo or a document, and the agent reads it from `Scratch/received/`. The web chat takes only text and voice notes. The web chat must take files too.

## Gaps and decisions

1. **Where a file goes.** Decision: `saveReceivedFile` puts it in `Scratch/received/`, as for Telegram. Git ignores `Scratch/`, and the weekly sweep removes old files.
2. **How the agent learns of the file.** Decision: the same note as Telegram, `[The person sent a file, saved as <path>]`. Move the note into `receivedFileNote` in `src/core/files/vault-files.ts`, so it has one home.
3. **The API shape.** Decision: `POST /api/files/received?name=<file name>` with the raw bytes as the body, the same as `/api/transcribe`. The answer is `{ path, note }`. The send route stays as it is: the page adds each note to the text.
4. **The size limit.** Decision: 25 MB, the same as a voice note. A larger file gets a 413 answer with a sentence.
5. **When the upload runs.** Decision: when the person picks the file. An error shows before the send, and Send waits for no upload. A file that the person removes stays in `Scratch/` until the sweep.
6. **A message with files and no text.** Decision: allowed. Send turns on when a file is attached.
7. **The composer layout.** Decision: the EVE design puts a `clip` button first in the composer row. Each attached file shows as a chip with its name and a remove button. A `ProgressBar` shows while an upload runs.
8. **The microphone.** Decision: it shows only when the box has no text and no file, as now with text.
9. **No vault.** Decision: the core throws `vault_not_found`, as the file explorer does.
