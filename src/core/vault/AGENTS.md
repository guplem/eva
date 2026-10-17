# Vault sync

- Sync never enters `Projects/*/repos/`.
- A conflict never loses a change. Never commit conflict markers, and never drop the stash.
- The secret scan keeps a file out of the commit. It never blocks the whole commit.
- Sync stays in Eva's code: never in agent hooks or git hooks.
