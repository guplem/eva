# Plan: skip the code-only CI work on a docs-only PR (#103)

This is the working plan for #103. The last commit of the PR deletes it.

## Goal

A PR that changes only docs skips the work of `web-ui`, `voice`, `package` and the Windows `checks` job. Each of these checks still reports success, so the merge ruleset needs no change. `checks` (Ubuntu) and `secrets` always run in full. A push to `main` and a PR with any other path run every job in full.

## Steps

1. Write a failing test for a function that takes a list of changed paths and says if each one is a docs path.
2. Write the function and a small script around it. The script reads the changed paths and writes `code_changed=true|false` to the step output.
3. Add a first job, `changes`, that runs the script on a PR. On a push, or when the diff fails, it says `code_changed=true`.
4. Make `web-ui`, `voice`, `package` and `checks` depend on `changes`. Put an `if:` on each step of the code-only work, not on the job.
5. Add a workflow comment that says why the steps skip and the jobs do not.

## Gaps

1. Where does the docs-path rule live: inline shell in the workflow, or a tested Bun script?
2. How does the job list the changed files of a PR?
3. What happens when the `changes` job fails? A failed `needs` job skips its dependents, and a skipped job may not satisfy a required check.
4. Does a new job, `changes`, need a change to the merge ruleset?
5. How does the `checks` matrix skip only its Windows run?
