# Plan: a direct file fix opens a pull request when the branch requires checks (#717)

## Why

A direct file fix of the setup report commits straight to the default branch.
A ruleset that requires checks refuses that commit.
Widget repositories get such a ruleset (#688), and the vibe-coded standard asks for one.
So Fix on an outdated skill fails there, and the fix goes to a chat.

## Plan

1. Add `landTree` in `src/core/projects/repository-fixes.ts`.
   It takes a tree change and lands it on a branch in one of two ways:
   - The branch requires checks: Eva commits on a new branch `eva/<topic>-<hash>`, opens a pull request, and turns on auto-merge.
   - Else: Eva commits on the branch, as today.
2. Read "requires checks" live from GitHub, with the reader of the report: `GET repos/<slug>/rules/branches/<branch>` and the classic branch protection of `GET repos/<slug>/branches/<branch>`.
   The setup of a new widget adds the ruleset last, so its first commit still goes straight to the branch.
3. Turn on auto-merge with the GraphQL mutation `enablePullRequestAutoMerge`, through `gh api graphql --input -`.
   This is the same call that `gh pr merge --auto` makes, and it goes through the existing `GithubWrite` seam.
   REST has no call for it.
4. Pick the merge method from the repository settings: merge, then squash, then rebase.
5. `commitFiles` uses `landTree`. The outcome gets `notes`: one line that names the pull request.
   The report card shows the notes in a neutral callout.
6. `#693` can call `landTree` for template and skill updates of widget repositories.

## Gaps and decisions

- **Unreadable rules.** Eva commits straight to the branch, as before. GitHub's refusal then names the reason, and the chat takes over.
- **An open pull request of Eva for the same change.** The branch name holds a hash of the change. When the branch exists, Eva reuses its open pull request and turns on auto-merge if it is off. She opens no second pull request.
- **Auto-merge refused,** for example when the repository setting is off. The fix fails with the pull request's address and GitHub's reason. The chat then gets both.
- **Only required checks choose the pull request path,** as the issue says. A ruleset that only requires a pull request is out of scope.
- **Never `bypass_mode: "always"`.** The ruleset stays as it is.
