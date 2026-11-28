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

- Save moves the file from `.eva/scratch/<name>.html` to `.eva/pages/<name>.html`. The vault sync commits it, and the 7-day clean never enters `.eva/pages/`.
- `resolveShownPage` stays stateless. For a marker in `.eva/scratch/`, a file of the same name in `.eva/pages/` wins. So the stored answer needs no rewrite, and a later edit of the saved file shows in the old answer.
- Save removes the scratch copy. So nothing shows two versions of one page.
- Name clash: two different pages with one name. The prompt tells Eva to give each new page a name that is free in both folders, and to edit a saved page in `.eva/pages/`. A clash that still happens shows the saved page, never a mix. Save writes with no overwrite: a file that appears at the target name meanwhile stops the save with a clear reason.
- A marker that names `.eva/pages/<name>.html` directly also works. Eva can write it in a later answer.
- Save refuses each page that `resolveShownPage` refuses, with the same reason: a page with a secret never reaches the sync. `.eva/` is never encrypted, so the docs say that a saved page is plain text in the vault history.
- Remove deletes the file in `.eva/pages/` only, and unpins it from each chat. The old marker then finds no file and shows the "gone" note.
- The writes go through the checks of the vault file code: `resolveShownPage` for the source, and a real path inside the vault for the target folder.

### The pin

- `pinnedPage: string | null` on the chat record: the vault path of the saved page. A record with no field, or a bad value, reads as null (`.default(null).catch(null)`), as `forkName` does. No migration: no stored value changes meaning, and an older Eva drops the field only when it writes the record. Not breaking.
- Pin saves first, then stores the saved path. Pin of another page replaces the first. Unpin stores null and keeps the file.
- A pin is a fact of one branch. A fork gets `pinnedPage: null`.
- A new event `page_pinned` tells every device. The web app reloads the chat list. Telegram and the terminal ignore it.
- Only Assistant chats pin: only they get the "Showing a page" prompt. A Project chat that shows a page offers Save.

### Routes

All behind the login, as the other page routes:

- `POST /api/pages/save {path}` answers `{ path }`, the saved path.
- `POST /api/pages/remove {path}` answers `{ path }`.
- `POST /api/sessions/<id>/pin {path | null}` answers the record.
- `POST /api/pages/frame` adds `kept` (`temporary`, `saved` or `note`) and `path` (the shown file) to a ready answer.

The page keeps its policy and its sandbox. Save and Pin add no permission, and the tests that pin both stay.

### Layout on a computer

To decide with captures. Two layouts to try:

- **A. Side by side.** The column sits between the chat and the inspector. The inspector stays beside it while the window has room. Otherwise it covers the column.
- **B. One right side.** The column takes the place of the inspector. The details button swaps the column for the inspector.

Limits: the chat keeps at least 480 px. The column is 320 px at least, so a page keeps the 300 px that the prompt promises. Its default is 400 px. Below the width that fits both, the bar of the phone shows.

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
