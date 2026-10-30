Open the pull request, and let it merge by itself.

1. Commit with a conventional-commit subject, such as `feat: show the streak of each habit`. The prefix picks the release: `feat` raises the middle number, and `fix`, `perf`, `refactor` and `build` the last one. Mark a breaking change with `!`.
2. Push the branch.
3. Open the pull request with `gh pr create`. Its body says what changed and why. With an issue, it holds `Closes #<number>`.
{% if steps.permissions.widens %}4. Add a section "New permissions" to the body, with one line for each of these: {{ steps.permissions.changes | join('; ') }}.
{% endif %}
Then turn on auto-merge with `gh pr merge --auto --merge <number>`. Use the person's GitHub login, as here: a merge that GitHub's own workflow token turns on starts no deploy and no release.
