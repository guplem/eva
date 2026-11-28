# Plan: save a page of a chat, and pin it beside the chat (#1130)

## Why

In a chat about data, Eva draws a chart as a page (#1129). The page lives 7 days in `.eva/scratch/`. The person wants to keep a chart, and to keep it in view on a computer while the chat goes on: "take captures, iterate a bit, and make something good".

## What the person sees

- The corner of each page frame gets two buttons before full screen: Save and Pin. Full screen shows them too.
- After Save, the Save button becomes a "Saved" pill with a check: a word and a shape, not a colour alone. A menu on the pill removes the saved page, after a confirm.
- A page that Eva wrote in a notes folder shows as saved, with no Remove: the Files page removes a note.
- On a wide computer window, a pinned page takes a column at the right of the chat, with a divider. Its header names the page and has Unpin and full screen.
- On a phone and in a narrow window, a pinned page is one bar above the message box: the page name and a tap to full screen, and Unpin.
- After each turn of the chat, the column and every frame of the chat load their page again, so a change by Eva shows by itself.

## Decisions

### Where a saved page lives, and how an old marker finds it

The first review found wrong-page cases in a rule by file name only. The orchestrator chose this model:

- **A name is one page.** The name of a page is its whole path under the scratch folder (`.eva/scratch/` or the old `Scratch/`). Save moves `.eva/scratch/a/chart.html` to `.eva/pages/a/chart.html`. So pages of different subfolders, such as a file that the person sent to `.eva/scratch/received/`, never share a saved file. The vault sync commits `.eva/pages/`, and the 7-day clean never enters it.
- **The name comes from the real path** (second review). `page-names.ts` starts from `join(root, marker)`, as `resolveSendableFile` does, resolves links and `..` parts, and compares with `relative`, which ignores case on Windows. A file that does not exist keeps the real path of its nearest folder. A marker that leads outside the two folders has no name, so it is a note, and Save keeps it as it is. Save refuses a marker whose own entry is a link, because the removal of the scratch copy would delete another file. It reads each level of `.eva/pages/` with `lstat` before it makes one. A scratch version that is a folder, or that Eva refuses, never hides a saved version of the name. Remove also takes the entry at the marker's own place inside `.eva/pages/`, such as a link, without following it.
- **The newest version answers.** When a scratch file exists at the marker's path, it is the page to show: Save removes the scratch copy, so a scratch file is newer than the saved one. It shows as not saved, with Save. Only when the scratch file is gone does the saved file answer the marker. `resolveShownPage` keeps no state, the stored answer needs no rewrite, and a later edit of the saved file shows in each old answer.
- **Save replaces an older saved page of the same name**, and removes the scratch copy. The vault history keeps the old version. Save never writes over another entry of `.eva/pages/`: a folder, a link or a file that is not a page stops it with a clear reason. It writes through the atomic write of `src/shared/files.ts`, so a file system with no hard links works, and a failed write names its cause, such as a full disk.
- A marker that names `.eva/pages/<name>.html` directly follows the same rule. Eva can write it in a later answer.
- Save refuses each page that `resolveShownPage` refuses, with the same reason: a page with a secret never reaches the sync. `.eva/` is never encrypted, so the docs say that a saved page is plain text in the vault history.
- **Remove always works for a saved page,** whatever it holds, such as a secret or more than 2 MB. It checks the path only: each folder from the vault to the file must be a plain folder, and a link goes, never its target. It unpins the page from each chat. The old marker then finds no file and shows the "gone" note. A note of a saved page that Eva refuses offers Remove too.
- The prompt still tells Eva to edit a saved page in `.eva/pages/` and to give a new page a free name.

### The pin

- `pinnedPage: string | null` on the chat record: the vault path of the saved page. A record with no field, or a bad value, reads as null (`.default(null).catch(null)`), as `forkName` does. No migration: no stored value changes meaning, and an older Eva drops the field only when it writes the record. Not breaking.
- Pin saves first, then stores the saved path. A pin is by name, so the column shows the newest version, as a marker does. Pin of another page replaces the first. Unpin stores null and keeps the file.
- A pin is a fact of one branch. A fork gets `pinnedPage: null`.
- A new event `page_pinned` tells every device. The web app reloads the chat list. Telegram and the terminal ignore it.
- Only Assistant chats pin: only they get the "Showing a page" prompt. The core refuses a pin of a Project chat with the `page_not_pinnable` code. A Project chat that shows a page offers Save.
- The Pin toggle keeps one name, "Pin <page> beside the chat", and `aria-pressed` gives its state. The visible word is "Pin" or "Pinned".
- The small Save button shows a `ButtonSpinner` and `aria-busy`, with no `ProgressBar`. Save is one local file write of 2 MB at most, so the wait is a flash. A bar under a 32 px row in a bubble would jump the row for that flash. A failure shows in a toast.

### Routes

All behind the login, as the other page routes:

- `POST /api/pages/save {path}` answers `{ path }`, the saved path.
- `POST /api/pages/remove {path}` answers `{ path }`.
- `POST /api/sessions/<id>/pin {path | null}` answers the record.
- `POST /api/pages/frame` adds `kept` (`temporary`, `saved` or `note`) and `path` (the shown file) to a ready answer.

The page keeps its policy and its sandbox. Save and Pin add no permission, and the tests that pin both stay.

### Layout on a computer

Two layouts tried with captures at 1280, 1600 and 1920 px, light and dark:

- **A. Side by side.** The column sits between the chat and the inspector. The inspector stays beside it while the chat keeps 480 px. Otherwise it covers the column. At 1600 px this gave three columns and a chat of 524 px: hard to read.
- **B. One right side.** The column takes the place of the inspector, and the details button shows the inspector over the column. The chat keeps 824 px at 1600 px, but a 1920 px screen wastes its room.

**Choice: A with a comfort width.** The inspector stays beside the column only while the chat keeps 640 px, as on a 1920 px screen. Below that, the details open over the column, with the dialog shadow, and only when the person presses the details button: the pin stays in view by default. So 1280 and 1600 px behave as B, and a wide screen shows everything. Reason: the pinned page is the work of the chat, and the details are a glance.

Limits: the chat keeps at least 480 px. The column is 320 px at least, so a page keeps the 300 px that the prompt promises. Its default is 400 px. Below the width that fits both, the bar of the phone shows. The width is per browser, as a Files column.

The row of Save and Pin sits under the frame, not in its corner: three corner buttons would cover the title of a chart, and the prompt keeps only 52 px of the corner free.

### Prompt and vault guide

- "Showing a page": the person can save or pin a page. A saved page lives in `.eva/pages/`. Look there first, and edit a saved page there, never as a new copy in `.eva/scratch/`. Give a new page a name that is free in both folders.
- A `.eva/pages/` line in the list of Eva's files, in the prompt and in `templates/vault/.eva/AGENTS.md` (a template part, so alignment updates old vaults).

## Gaps and answers

- **Stored-answer rewrite?** None: the stateless rule in `resolveShownPage`.
- **Migration for the pin?** None: tolerant read, as `forkName` (`src/core/migrations/AGENTS.md`).
- **Remove for a page in a notes folder?** No: it is a note of the person, and the Files page removes it.
- **Pin in a Project chat?** No: a Project chat is a clean wrapper and gets no page prompt.
- **Column width home?** Per browser, as the width of a Files column: a view choice, not a setting.

## Docs

`docs/guide/reference.md`, `docs/guide/how-eva-works.md`, and a line in the EVE guide for the chat page.
