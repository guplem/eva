# Plan: encrypted vault secrets (#707)

The issue holds the decisions and the assumptions. This plan maps them to the code and lists the gaps.

## Work units

1. **Crypto** (`src/core/vault/vault-crypto.ts`, done): X25519 key pair, private key wrapped with scrypt, files with HKDF and AES-256-GCM.
2. **The list of secret files** (`src/core/vault/secret-files.ts`): the defaults in code, `.eva/secret-files` in `.gitignore` syntax, the paths that Eva never encrypts, one matcher for every caller, and the record of the accepted patterns.
3. **The key store:** `.eva/vault-key.json` in the vault. Each machine keeps the key's fingerprint in its state folder. The key is made after a pull, and kept only after its push succeeds (the hub claim pattern). Unlocked keys stay in memory, per device token hash, for 8 hours. "Lock", a forgotten device and a restart drop them.
4. **The vault sync** (`vault-sync.ts`): one "prepare the files" step before each commit and each snapshot encrypts each plain secret file in place. New withheld reasons: no key yet, a changed key, an encrypted file that does not decrypt, and a plain `.env` with a token. The content scan covers `Projects/` too, but not `Projects/*/repos/`. Eva writes the `.gitattributes` lines from the list.
5. **Every caller of `looksLikeSecretsFile`** uses the new matcher: the Files page, downloads, search, Telegram and mentions. An encrypted file gets its own answer: "open it in Eva's web app".
6. **The Files page:** a lock on an encrypted file, Unlock with the password, the text with a copy button or a download, a save that writes the encrypted text, Lock, and the last commit that changed the file. Routes keyed on the device token: a request with the local API token never decrypts.
7. **Settings:** a card with each default and a switch, the person's own patterns, and each removal that waits, with its warning and a Confirm that needs an unlocked device. The vault password: set, change, and "New key".
8. **Setup:** the terminal and the web app ask for the password of a new vault twice.
9. **Notices:** no password yet, a changed key, a file that does not decrypt, a plain `.env` with a token, and a new default that encrypted files.
10. **Template and migration:** the vault's `.gitignore` stops ignoring the secret patterns and plain `.env`; `.gitattributes`; the map's secret rule. A dated migration merges these into an existing vault.
11. **Eva's own repository:** a check in `bun run check` fails on a tracked file that matches a default pattern.
12. **Texts:** the goal in `AGENTS.md`, the vault map, `docs/guide/reference.md`, the false comment on `looksLikeSecretsFile`, and a line in `src/core/vault/AGENTS.md`: a release that takes out a default is breaking.

## A design point the issue leaves open

An agent can edit any file of the vault, so a record of the accepted patterns there could drop a pattern by hand. Then the next plain secret file of that kind would reach the remote in plain text. The encrypted files stay safe: only the password decrypts them.

So the key file also holds an Ed25519 key pair, wrapped with the same password. A removal that the person confirms from an unlocked device signs the new record. Every machine checks the signature with the plain public key, and needs no password. An unsigned or badly signed removal counts as no removal.

## Gaps

1. Is the signed record of the accepted patterns the right answer to an agent that drops a pattern? Is there a simpler one that holds across machines?
2. The exact format of `.eva/secret-files` and of the record, and how Eva reads an old or broken one.
3. How a removal that one machine confirms reaches another machine, and when that machine decrypts nothing, since it holds no unlocked key.
4. The `.gitignore` matcher: a small parser of our own, or a dependency already in the tree?
5. The API of the Files page for an encrypted file, and how the web app asks for the password.
6. Where the unlocked keys live, and how a device's key goes when the device is forgotten.
7. The text of each notice and each withheld reason.
8. The vault `pre-commit` hook that the issue suggests: needed now, or later?
9. How a binary secret file, such as a `.p12` file, opens: download only?
10. The migration of an existing vault's `.gitignore`, which the person may have edited.
