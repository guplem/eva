# Encrypt any file from the Files page (#1108)

## Goal

The Files page encrypts any vault file with one action. The action adds a `.eva-secret` end to the name. A fixed pattern, `*.eva-secret`, keeps such a file encrypted, and nobody can turn it off. The download of an unlocked file drops only a final `.eva-secret`.

## Changes

1. `src/core/vault/secret-files.ts`: a new constant `fixedSecretPatterns = ["*.eva-secret"]`, apart from `defaultSecretPatterns`.
2. `src/core/vault/secret-policy.ts`: `activeSecretPatterns` always adds the fixed patterns to `active`, and never to `waiting`. Every reader of the active patterns goes through this function, so one change covers the round, `.gitattributes`, `secretMatcherOf` and the status.
3. `src/core/vault/vault-encryption.ts`: a public method that encrypts one file by name. Inside `vault.exclusive`, it checks the file, renames it to `<name>.eva-secret`, and encrypts it at once with `VaultSecrets.prepare`. When the file is not encrypted after that, it renames the file back and refuses with the reason. Then it commits and pushes, as `persist()` does.
4. `src/core/files/file-browser.ts`: `renameVaultEntry` lets an encrypted file get a `.eva-secret` name, so the person can rename `photo.jpg.secrets` by hand.
5. `src/core/eva.ts`, `src/frontends/api/local-api.ts`, `src/frontends/web/client/api.ts`: a route `POST /api/files/encrypt`.
6. `src/frontends/web/client/FilesView.tsx`: a lock button in the header of an open plain file, with a `window.confirm`, as the other dangerous actions of the page do. After the action, the page opens the new path.
7. `src/frontends/web/client/file-kinds.ts`: `decryptedNameOf` drops only a final `.eva-secret`.
8. `src/frontends/web/client/EncryptedFilesCard.tsx`: the pattern list shows `*.eva-secret` as a line with no switch.
9. Tests: unit tests for each core change, `file-kinds.test.ts`, and browser tests in `test/e2e/web-ui.spec.ts` with demo files in `test/e2e/serve-demo.ts`.
10. Docs: `docs/guide/reference.md`, "Encrypted files" and "Files".

## Gaps

- **G1. Where does the fixed pattern apply?** Inside `activeSecretPatterns`, or in each caller?
- **G2. Which files does Encrypt refuse, and how?** Check each case before the rename, or encrypt and check the result?
- **G3. Which renames of an encrypted file does `renameVaultEntry` allow?**
- **G4. Who may encrypt?** Any login, or only a device that logged in with a code or a link?
- **G5. Where is the action on the page,** for text, media and other files?
- **G6. Does Settings show the fixed pattern?**

## Decisions

Three researchers (two mid-tier, one top-tier) agreed on each gap.

- **G1. Inside `activeSecretPatterns`.** A new input, `fixed`, joins `active` after the removal filter and never joins `waiting`. Every reader of the patterns goes through this function. The top-tier researcher found one more risk: a signed record and this machine's memory (`applied`) named the fixed pattern, so an older Eva on another computer would show it as a removal that waits, and her confirmation would decrypt its files. `signedPayload` and `applied` now leave the fixed patterns out.
- **G2. Check first, then encrypt at once, and check the result.** `encryptMoveOf` (file browser) checks the path: no folder or link, no file in `.eva/` (scratch too) or in a clone, no file that Eva never encrypts (`isNeverEncrypted` of the old path, so `AGENTS.md` stays), no taken name, no name over 255 bytes. `VaultEncryption.encryptByRename` checks the key, the size and an existing secret, inside `vault.exclusive`. It renames, encrypts the one file with `VaultSecrets.prepare`, and renames back when the file is not in Eva's encrypted shape. A file that git ignores is encrypted too: it stays on this computer, so no refusal is needed (a change from the issue's assumption). Error codes are existing ones: `file_not_found`, `file_not_writable`, `vault_key_missing`, `vault_key_invalid`.
- **G3. Only an encrypted file, and only to a `.eva-secret` name.** A file keeps its old path sealed inside, and `decryptFiles` refuses such a file. So another secret name could stop an all-or-none pattern removal. `*.eva-secret` is never removed. #1109 must accept a sealed path that differs.
- **G4. Any login, as for a rename.** Encryption needs no password and shows nothing. The route lives under `/api/vault/secrets/`, which has no idle limit, because it commits and pushes.
- **G5. A lock button in the header, beside Rename,** for every open answer that is not a folder and not encrypted. The core refuses with a reason, and the error toast shows it. A plain `.env` also gets the button. An unsaved edit stays behind, because it is plain text.
- **G6. A `fixed` status field,** shown as "Always on" with no switch.
