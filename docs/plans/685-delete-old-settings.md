# Delete the old places of the vault settings (#685)

## Why

#662 moved `.eva/settings.json` and `.eva/chat-names.md` into `.eva/settings/`. For one release, Eva kept writing the old files, so an older satellite still read them. Releases v5.32.0 to v5.57.1 shipped since. The old files now only cost code and confuse an agent that reads the vault.

## Changes

1. A new vault migration, `2026-11-22-delete-old-settings-files`, deletes `.eva/settings.json` and `.eva/chat-names.md`.
   - It waits until `2026-10-30-settings-folder` is in the vault's record. Before that, the old files hold the only copy.
   - It keeps a copy of each file in the machine's migration backups before the delete.
2. A new machine migration, `2026-11-22-model-tiers-in-config-again`, moves `engines.claudeCode.defaultModel` in `config.json`, as `2026-10-24-model-tiers-in-config` does.
   - It waits only while the vault has no settings file in either place. The old migration waits while `.eva/settings.json` is missing, so it would wait forever after the delete.
   - Once the new one runs, the old one finds nothing to change and records itself at the next start.
3. `src/core/settings/settings-folder.ts` keeps only `vaultSettingsFolder`. `oldPath`, `readablePath`, `settingsFileExists` and the double write go.
4. `settings.ts` and `chat-namer.ts` read and write `.eva/settings/` only.
5. `withOldVaultKeys` goes too. Its own note says "one release after #550", and many releases shipped since. Eva still reads the old vault key tolerantly.

## Gaps and decisions

- **A satellite older than #662** reads only the old files, so it shows default settings until it updates. The `vault_ahead` gate already stops it from writing. The issue accepts this: one release has passed.
- **A hub older than #662** never runs the new migration, so its vault keeps the old files. A new satellite then reads only the new place. This needs a hub 29 releases behind, so the change accepts it.
