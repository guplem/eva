# Plan: resolve a vault conflict from the phone (#49)

This is the working plan for #49. The last commit of the PR deletes it.

## Goal

A vault conflict today needs a terminal: edit the markers, `git add`, `eva sync`. The owner uses Eva only from a phone. From Telegram or the web page, the person sees each conflicted note and picks "keep mine", "keep theirs" or "keep both". After the last pick, Eva pushes again. No pick discards a change silently.

## The two kinds of conflict

1. **Committed edits** ("diverged"): the local commits and the remote commits change the same lines. The rebase stops, Eva aborts it, and keeps the local commits. Nothing is in the files.
2. **Edits that were not committed** ("markers"): the autostash did not apply cleanly after a pull. The files hold conflict markers, and the index holds both versions (stage 2: the remote's, stage 3: this machine's).

A third shape, where older git keeps the edits only in the stash, gets one `git stash apply` (never a drop). That turns it into kind 2, or applies cleanly.

## Steps

1. `VaultSync.conflicts()`: lists the conflicted notes. Kind 2 comes from the unmerged paths. Kind 1 comes from `git merge-tree --write-tree --name-only HEAD origin/<branch>`, which touches no file.
2. `VaultSync.resolve(path, choice)`, with `choice` = `mine`, `theirs` or `both`.
   - Kind 2: apply at once with `git checkout --ours/--theirs`, `git add`. "Both" moves the remote's version to a copy beside the note. After the last file, run the normal save: commit, then push.
   - Kind 1: keep the pick in memory. After the last pick, build a merge commit with plumbing in a temporary index: the merge-tree result, with each conflicted path set to the picked blob. Then `git merge --ff-only` to it, and push. The worktree changes only in the fast-forward, which git refuses when it would overwrite an edit.
3. Name the files in each conflict message, and drop the terminal steps from it.
4. `Eva.vaultConflicts()` and `Eva.resolveVaultConflict()`, refused while an Assistant turn runs (like `syncVault`).
5. Local API: `GET /api/vault/conflicts`, `POST /api/vault/conflicts` with `{ path, choice }`.
6. Telegram: `/conflicts` sends one message per note with three buttons. The button data holds an `OfferStore` id, because a path can pass the 64-byte limit.
7. Web: the Settings sync section lists the notes with three buttons each.
8. The conflict alert says: send /conflicts, or open Settings in the web app.
9. Update `docs/guide/reference.md`.

## Gaps

1. Where do the picks of kind 1 live until the last one: memory or a state file?
2. How does Eva build the resolved result of kind 1: a merge commit, a rebase, or a worktree merge?
3. In "keep both", which version stays at the path, and what is the name of the copy?
4. Is a new Telegram command (`/conflicts`) fine without the owner, or should `/sync` show the conflicts?
5. Does "keep mine" or "keep theirs" discard a change silently? Git history keeps both versions, so the message can say so.
6. What if the remote moves again between the resolution and the push?
