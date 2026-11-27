# Decrypt a .eva-secret file from the Files page (#1109)

## Goal

An unlocked `.eva-secret` file gets a **Decrypt** action. It warns that the plain text goes to the vault remote at the next save. Then it writes the plain file under the name without the end, deletes the encrypted file, and saves.

## Changes

1. `src/core/files/file-browser.ts`: `decryptMoveOf(vaultPath, requested)`, beside `encryptMoveOf`. It checks the path and gives the new name without `.eva-secret`.
2. `src/core/vault/vault-encryption.ts`: `decryptByRename(deviceToken, secret, from, to)`. Inside `vault.exclusive`, it needs an unlocked device and a key that did not change. It decrypts the bytes, writes them under the new name, and deletes the encrypted file. Then it commits and pushes.
3. `src/core/eva.ts`, `src/frontends/api/local-api.ts`, `src/frontends/web/client/api.ts`: a route `POST /api/vault/secrets/decrypt-file`, which passes the device token and the unlock header.
4. `src/frontends/web/client/FilesView.tsx`: the unlocked view of a `.eva-secret` file gets the action. After it, the page opens the new path.
5. Tests: unit tests for each core part, and browser tests.
6. Docs: `docs/guide/reference.md`, "Encrypted files".

## Gaps

- **G1. Does the action need a signed record,** like a pattern removal?
- **G2. Which path does the action trust:** the sealed path inside the file, or its current path?
- **G3. Which new names does the action refuse,** and how does it know that another pattern covers the name?
- **G4. Where is the action on the page,** for a text file and for a binary file?

## Decisions

Filled in after the research.
