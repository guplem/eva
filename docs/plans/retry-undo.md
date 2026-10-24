# Undo the file changes of a retried Assistant answer (#525)

## Motivation

A person retries a bad answer to get a better one. The bad answer may have changed notes in the vault.
The sync commits and pushes those changes after the turn, so the new answer starts from them.
The person wants the new answer to start from the files as they were before the bad answer.

## Design

### Snapshots

- Before each Assistant turn (after the pull) and after it (before the save), `VaultSync.snapshot` saves the files of the vault as a commit with no parent.
- A hidden ref keeps each snapshot: `refs/eva/turns/<session id>/<turn index>/before` and `.../after`. The push sends only the branch, so the refs stay on this machine.
- The snapshot builds its tree in a temporary index: `read-tree HEAD`, then `update-index --add --remove` with the paths of `git status`. The real index never changes.
- The snapshot leaves out what the sync leaves out: Scratch files and withheld files (a secret, or too large). Their objects never go into git.
- The commit message of a snapshot lists each left-out file with its size and change time. Files under `Scratch/` are listed too, as the vault's `.gitignore` usually ignores that folder.
- `AssistantPreparer` takes the snapshots. It knows the turn index from `prepare`: `session.turns.length`.
- A delete of a chat deletes the refs of each deleted session.

### The answers to undo

- The answers to undo are every turn of the chat tree (the root chat and all its forks) that ended at or after the retried turn, ordered by their end time (`turn.at`).
- So a retry of answer 2 in a chat at answer 5 undoes answers 2 to 5. A fork that ran later on the same vault is undone too: every chat shares one vault.
- Turns with no snapshot (older turns, Project chats) add nothing.

### The undo plan

For each file that an answer changed (the difference between its two snapshots):

- The target is the file in the `before` snapshot of the first answer that changed it.
- The expected file is the file in the `after` snapshot of the last answer that changed it.
- When the file now equals the expected file, Eva restores the target. Absent in the target: Eva deletes the file.
- When the file now equals the target, nothing changes.
- Otherwise someone changed the file after the answer. It stays, and the list names it as "changed".
- A left-out file whose size or change time differs between the two snapshots of an answer goes in the "not kept" list. Eva never restores it.

### Restore

- `git restore --source=<before snapshot> --worktree` writes each file, grouped by snapshot, so line endings follow git's filters. A file absent in the target is deleted.
- The restore never touches the index, never rewrites history, and never uses `git revert`.

### Retry flow

- `GET /api/sessions/<id>/retry-undo?turnIndex=N` returns `{ restore, changed, notKept }`: lists of paths.
- `POST /api/sessions/<id>/retry` takes `{ turnIndex, undo?: boolean }`. With `undo: true`, Eva:
  1. refuses with `session_busy` while an Assistant chat runs a turn, as a conflict pick does;
  2. pulls, computes the plan again, restores the files, and saves through the normal vault sync;
  3. retries as before.
- A failed restore refuses the retry with `git_failed` and its reason. A save that goes offline or meets a conflict does not stop the retry: the files are restored here.
- The web app asks before a retry of an Assistant answer only when `restore` or `changed` is not empty. The dialog says that only files go back, lists the three groups, and offers "Undo" (default), "Keep" and "Cancel".

## Gaps and decisions

1. **Which later answers?** The issue does not say how forks count. Decision: every turn of the chat tree that ended at or after the retried turn. This follows "every Assistant chat shares the one vault".
2. **Files that git does not keep.** Listing every ignored file is slow: `Projects/*/repos/` holds whole clones. Decision: track Scratch files and the files that the sync withholds. Other ignored files are not tracked and not named.
3. **A question with only "not kept" files.** Nothing could be undone, so Eva asks nothing, as with no change (assumption 1).
4. **Sync off.** Eva runs no git step of her own, so she takes no snapshot, and a retry asks nothing.
5. **Telegram.** Out of scope (assumption 9).
6. **Old turns.** Turns from before this change have no snapshot. Their retry asks nothing.
