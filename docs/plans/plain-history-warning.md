# Warn about plain versions on the vault remote (#1110)

## Goal

When Eva encrypts a file whose plain text is already on the vault remote, she tells the person once: the old versions stay in the git history, so a key or a password in the file should be changed. The Encrypt question says it too, before the change. Eva never rewrites the history.

## Changes

1. `src/core/vault/vault-secrets.ts`: the round records each file that it encrypts in place, and `takeNewlyEncrypted()` hands the list over once, as `takeNewDefaults()` does.
2. `src/core/vault/vault-encryption.ts`: the Encrypt action records the old name of each file that it renames, because the plain versions are under that name.
3. `src/core/vault/vault-sync.ts`: `plainOnRemote(paths)` answers which paths have a plain version in the history of the remote branch.
4. `src/core/eva.ts`: after each round, Eva checks the new list and raises one open notice that names the files. The notice stays until the person dismisses it, so a satellite's report carries it to the hub and the phone.
5. A route and the page: the Encrypt question asks the core first and adds the warning when the file has plain versions on the remote.
6. `src/core/alerts/problem-rules.ts`: the text of the notice.
7. Tests and the guide.

## Gaps

- **G1. Where does Eva learn that a file became encrypted?** The round, the Encrypt action, or both?
- **G2. Which alert carries the notice,** so it reaches the phone from a satellite and shows once for each file?
- **G3. How does Eva know that a plain version is on the remote?** Which git steps, and how fresh is the remote branch?
- **G4. How does the Encrypt question learn it before the change?**

## Decisions

Filled in after the research.
