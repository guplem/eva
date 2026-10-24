# Plan: clone push safety (issue #502)

## Motivation

Eva works from a phone. A "Push" button that commits conflict markers, a broken clone that Eva reuses, and a project list that one bad folder empties are failures the person cannot fix from the phone.

## Changes

1. `src/core/projects/clone-sync.ts`, `commitAndPush`:
   - Before `git add`, refuse with `EvaError("git_failed")` when the status has an unmerged code (`DD`, `AU`, `UD`, `UA`, `DU`, `AA`, `UU`).
   - Refuse when the git folder holds `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `rebase-merge` or `rebase-apply`.
   - Read the branch before the commit, so a detached HEAD makes no commit.
2. `src/core/projects/clones.ts`, `createClone`: when `git clone` fails or throws, remove the new folder, then report the failure.
3. `src/core/projects/project-catalog.ts`: skip a root that `readdirSync` cannot read, and a project whose `AGENTS.md` Eva cannot read.

## Gaps and decisions

- **A merge with every conflict solved:** a commit would end the merge. Decision: refuse it too. The person ends the merge in a chat. Reason: the safest choice, and the finding asks for it.
- **How to find the git folder:** use `git rev-parse --git-path <name>` for each marker. It works for a worktree clone too, where `.git` is a file.
- **The ignored-files rule for a delete:** it protects the person's files. The folder is new: `cloneFolderName` picked a name that did not exist, and the clone choice runs one at a time per project. Decision: remove it only when it did not exist before the clone. Use `rmSync` with retries in a `try`, as other folder removals do.
- **Error code:** keep `git_failed`, as the other refusals of `commitAndPush` do. No new `EvaErrorCode`, so no schema change.
- Sub-agents were not available in this session, so the research of the gaps was done by hand.
