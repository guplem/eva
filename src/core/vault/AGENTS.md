# Vault sync

- Never let sync enter `Projects/*/repos/`.
- Never lose a change in a conflict. Never commit conflict markers, and never drop the stash.
- When the secret scan flags a file, commit the other files and leave that file out. Never let the scan block the whole commit.

# Template alignment

- Add each new skill of `templates/vault/` to `templateParts` in `vault-template.ts`, so existing vaults get it.
- Change a template part freely: the record keeps the hash of each version that Eva wrote.

# Encrypted files

- Treat a release that takes out a default secret pattern as a breaking change: mark it with `!`. Move the pattern to `retiredSecretPatterns`, never delete it.
- Never decrypt a file because a pattern went away. Only a removal that the person signs decrypts.
