# Vault sync

- Never let sync enter `Projects/*/repos/`.
- Never lose a change in a conflict. Never commit conflict markers, and never drop the stash.
- When the secret scan flags a file, commit the other files and leave that file out. Never let the scan block the whole commit.

# Template alignment

- Add each new skill of Eva to `eva-core`, not to `templateParts`.
- Change a template part freely: the record keeps the hash of each version that Eva wrote.
- `.eva/AGENTS.md` is a template part: it describes only Eva's own folder, so it is true in every vault.
- Never make the root `AGENTS.md` or a `Life/` rule file of `templates/vault/` a template part: alignment would change the structure of every old vault. A change to one needs a matching `vault-upgrade` CHANGELOG entry (#773).

# Encrypted files

- Treat a release that takes out a default secret pattern as a breaking change: mark it with `!`. Move the pattern to `retiredSecretPatterns`, never delete it.
- Never decrypt a file because a pattern went away. Only a removal that the person signs decrypts.
