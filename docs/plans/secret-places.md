# Plan: where each kind of secret goes (#1095)

## Goal

The vault template gives one rule with three questions, in order, for where a secret goes. Eva encrypts a plain `.env`. The `vault-upgrade` skill offers the rule to an existing vault.

## Changes

1. `templates/vault/AGENTS.md`:
   - Replace the rule "A password or a key of something in the vault" in _Where things go_ with the three questions.
   - The password manager row of _Outside the vault_ names the recovery codes of an account, a card PIN, the Wi-Fi password and a door code.
   - The _Secrets_ rule of the writing rules points to the three questions.
2. `templates/vault/Life/Inventory/AGENTS.md`: the `.secrets` line follows the three questions. The password manager's own item holds its encrypted recovery kit, and says where the paper copy is.
3. `src/core/vault/secret-files.ts`: add `.env` to `defaultSecretPatterns`. The existing new-default news tells each vault.
4. Docs and texts that say a plain `.env` stays plain: `docs/guide/reference.md`, the template `.gitignore` comment, the alert text.
5. `vault-upgrade` CHANGELOG: a v16 entry. Record the new shipped text with `scripts/vault-template-history.ts`.

## Gaps

- **G1. Encrypt a plain `.env`, or only warn?**
- **G2. Where does the encrypted recovery kit live?**

## Decisions

Filled in after the research.
