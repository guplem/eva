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

Three researchers (two mid-tier, one top-tier) agreed on each gap, with the additions below.

- **G1. No signed record.** A record exists because an agent can edit `.eva/secret-files`. Decrypt changes no pattern, and only an unlocked device gets the key (`keyFor`). Other computers flag only a file that an active pattern covers (`isPlainSecret`), so the new plain file is a normal file there. A computer with a pattern that this one lacks would encrypt it again: harmless, as the plain text is already on the remote.
- **G2. The current path decides, with one check.** A file renamed by hand keeps its old sealed path, so an exact match would block the main case. But two researchers found a real risk: an agent can copy a secret to a harmless name, and Decrypt would push its plain text. So a sealed path that differs must be in the same folder, and its name must start with the plain name and a dot, such as `photo.jpg.secrets` for `photo.jpg`. Any other sealed path stays encrypted. A conflict copy, such as `photo.jpg (conflict copy).eva-secret`, stays encrypted too: the person renames it first.
- **G3. Refusals.** The name must end in `.eva-secret`, in any case, and leave a valid name. The file must be a regular file in Eva's encrypted shape. Eva refuses a new name that `secretMatcherOf` covers (active patterns, the fixed one and plain env names), checks the round's own patterns again inside the lock, and refuses a taken name, a file in a clone and a name that `isNeverEncrypted` covers, such as `AGENTS.md`. A scratch folder needs no refusal. Eva writes the plain file first, then deletes the encrypted one, and removes the plain file when the delete fails.
- **G4. In the unlocked view.** A text file gets a menu item beside "Lock encrypted files". A file that is not text gets a button beside Download. A `Column` prop carries the page's `decrypt`, which calls the route, drops the draft and opens the new path. The question names the new name, the remote and an unsaved edit.
