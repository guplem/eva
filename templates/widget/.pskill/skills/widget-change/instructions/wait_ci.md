Wait for the checks of pull request #{{ steps.open_pr.pr_number }}: `gh pr checks {{ steps.open_pr.pr_number }} --watch`.

- When a check fails, return `failed` with each failed check.
- When every check passes, auto-merge merges the pull request. Check it with `gh pr view {{ steps.open_pr.pr_number }} --json state`, and return `merged` once its state is `MERGED`.
- When the branch is behind main and GitHub waits for an update, run `gh pr update-branch {{ steps.open_pr.pr_number }}` once, and wait again.
