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

## Gaps and decisions

Three agents checked each gap. They tested the git steps on git 2.43.

1. **Where the picks of kind 1 live.** In memory, by path. A restart loses only the picks already made, and `conflicts()` rebuilds the list from git. The Telegram buttons still work after a restart, because `OfferStore` keeps their ids on disk (lesson 124). Picks are not tied to HEAD: each sweep adds a commit while the person picks. At the last pick, Eva runs merge-tree again on the current HEAD. A pick for a path that no longer conflicts is dropped. A new conflicted path waits for its own pick.
2. **How Eva builds the result of kind 1.** A merge commit, built with plumbing: `git merge-tree -z --write-tree --no-messages HEAD origin/<branch>` gives the tree and, per conflicted path, the blob of each stage (2: this machine, 3: the remote). Eva reads that tree into a temporary index, sets each picked blob, writes the tree, and runs `git commit-tree -p HEAD -p origin/<branch>`. Then `git merge --ff-only` moves the worktree. Git refuses the fast-forward when it would overwrite an uncommitted edit, so nothing is lost. A merge-tree failure (git older than 2.38) is an error with that reason, never "no conflicts".
3. **"Keep both".** This machine's version stays at the path. The other version goes to `<stem> (conflict copy)<ext>` beside it, or `(conflict copy 2)` when the name is taken. When one side deleted the note, "keep both" keeps the version that exists. So all three buttons always make sense.
4. **The command.** A new `/conflicts` command needs no owner: the rule covers renames only. The buttons use the free letter `c` and an `OfferStore` id.
5. **No silent loss.** In kind 1, the merge commit keeps both versions as parents. In kind 2, this machine's version was never committed: after "keep theirs" it stays only in the stash, which Eva never drops. The messages say so. In kind 2, stage 2 is the remote's version and stage 3 is this machine's, so "keep mine" takes stage 3. A test covers that swap.
6. **The remote moves before the push.** A rebase would flatten the merge commit and bring the conflict back. So while `origin/<branch>..HEAD` holds a merge commit, the sync merges the remote with the same plumbing instead of a rebase. A clean result becomes a merge commit; a conflict is kind 1 again.

Other decisions:

- Kind 2 can lead to kind 1: after the last kind 2 pick, the push can meet a new conflict. `conflicts()` then shows kind 1.
- The third shape (older git keeps the edits only in the stash) gets one `git stash apply` right where Eva notices it, so it applies the newest stash entry, which is that autostash. A conflict turns it into kind 2.
- Only the hub runs Telegram. A satellite's conflict is resolved on that satellite's web page. The alert names both ways.
- Resolution is refused while an Assistant turn runs, like `syncVault`.
