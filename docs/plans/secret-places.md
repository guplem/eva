# Plan: where each kind of secret goes (#1095)

## Goal

The vault template gives one rule with three questions, in order, for where a secret goes. The `vault-upgrade` skill offers the rule to an existing vault.

## Changes

1. `templates/vault/AGENTS.md`: the rule "Where a secret goes" in _Where things go_, the password manager row of _Outside the vault_, and the _Secrets_ rule.
2. `templates/vault/Life/Inventory/AGENTS.md`: the secret line follows the rule. The password manager's item holds `Recovery kit.secrets`.
3. `docs/guide/reference.md`: one paragraph on where each secret goes.
4. `vault-upgrade` CHANGELOG: a v16 entry. `shipped-texts.json` records the new vault map.

## Decisions

- **G1. A plain `.env`: the owner chose to keep it plain.** Eva keeps her current behavior: a plain `.env` syncs as it is, and one with a token-shaped value stays out of each save with an alert. The vault map now sends a key that code reads to `.env.local`, never to a plain `.env`. The research split on this: encryption breaks a program in a project folder that reads `.env` (`src/core/files/secret-paths.ts`).
- **G2. The recovery kit lives in `Recovery kit.secrets` beside the password manager's `Item.md` in `Life/Inventory/`.** All three researchers agreed. The note says where the paper copy is. This follows the `Licence.secrets` pattern of the Inventory rules.
- **The master password leaves the password manager row.** Keeping it inside the manager is circular. The recovery kit rule covers it.
