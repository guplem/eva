# Plan: vault sync robustness (#505)

## Why

Three cases stop the vault sync for good. Two of them say nothing to the phone. "Eva works from a phone" says each problem must reach the phone, and a fix that needs a terminal is a gap.

## Changes

1. `commitChanges` in `src/core/vault/vault-sync.ts` passes the paths to `git add` and `git commit --only` on stdin, with `--pathspec-from-file=- --pathspec-file-nul`. The command line stays short, whatever the number of files. The private `git()` helper gets an optional `stdin`.
2. `serialize` removes a `.git/index.lock` that is older than 10 minutes, before each sync step, and logs a warning. `statusEntries` runs `git --no-optional-locks status`.
3. `defaultBranch()` falls back to the upstream of the current branch, before `main`, when `origin/HEAD` is missing. `vaultSyncProblem` raises a warning for a `skipped` state.

## Gaps and decisions

- **Which git version does `--pathspec-from-file` need?** Git 2.26 (2020). Eva already asks for git 2.38 to resolve a conflict (`mergePlan`). Decision: use it. No fallback.
- **How old is a stale lock?** No git step of the sync runs longer than the network timeout (60 s). A person's own git step that holds the lock for 10 minutes is very rare. Decision: 10 minutes. Compare with the real clock (`Date.now()`), because the file time is real.
- **Does the removal of the lock need an alert?** Decision: no. A log line is enough. The sync works again, so no problem stays.
- **Which branch when `origin/HEAD` is missing?** Decision: the upstream of the current branch when it is on `origin`, then `main`. A vault on a feature branch with an upstream and no `origin/HEAD` then syncs that branch. This is rare, and the push goes to the branch's own upstream, so nothing is lost. A vault with `origin/HEAD` keeps the old behavior.
- **Which `skipped` states raise the alert?** Only `VaultSync` returns the branch skip to `VaultUpkeep.logSyncState`. The "Assistant is busy" skip of `syncNow` and `resolve`, and `noVaultState`, never reach `vaultSyncProblem`. Decision: a `skipped` state with a reason is a warning. A `skipped` state with no reason keeps the open alert, as before. No new status value: the status is a sent name.
- **Wording of the skip alert.** It names the branch and the fix from a phone: ask the Assistant to switch the vault back, then send /sync.

## Out of scope

- #415 (Scratch files) and #447 (redaction) are closed. This plan does not touch their code.
