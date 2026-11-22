# Delete the old places of the vault settings (#685)

## Why

#662 moved `.eva/settings.json` and `.eva/chat-names.md` into `.eva/settings/`. For one release, Eva kept writing the old files, so an older satellite still read them. Releases v5.32.0 to v5.57.1 shipped since. The old files now only cost code and confuse an agent that reads the vault.

## Changes

1. A new vault migration, `2026-11-22-delete-old-settings-files`, deletes `.eva/settings.json` and `.eva/chat-names.md`.
   - It waits until `2026-10-30-settings-folder` is in the vault's record. Before that, the old files hold the only copy. It also waits for `2026-10-18-start-vault-settings`, which writes the old place.
   - It keeps a copy of each file in the machine's migration backups before the delete.
2. A new machine migration, `2026-11-22-drop-old-shared-keys-from-config`, drops the 2026-10-18 vault keys from `config.json`.
   - Two frozen machine migrations wait while `.eva/settings.json` is missing: `2026-10-18-move-shared-settings-to-vault` and `2026-10-24-model-tiers-in-config`. After the delete, both would wait forever.
   - The new one waits only while the vault has no settings file in either place. The 2026-10-18 keys hold every key that the tier migration changes. So once the new one runs, both old ones find nothing to change and record themselves at the next start.
3. Eva reads the old file and writes both places only while the old file waits for the move: the old file exists and the move is not in the record. After the move, Eva reads and writes only `.eva/settings/`. `settingsFileExists` goes.
   - The issue asked to drop the old place fully. A review found that this loses the person's settings while the move waits: a new satellite or `eva setup` on a vault whose hub has not moved the files, a held vault upgrade, or a broken old file. Eva would read defaults, and the next save, or the move, would write over the real values.
4. `withOldVaultKeys` goes. Its own note says "one release after #550", and many releases shipped since. Eva still reads the old vault key tolerantly.

## Gaps and decisions

- **A satellite older than #662** reads only the old files, so it shows default settings once the hub deletes them. The `vault_ahead` gate already stops it from writing. The issue accepts this: one release has passed.
- **A settings problem reaches only the log.** This was already so before this change. A separate issue can send it to the phone.
