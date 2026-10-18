# Plan: migrate stored files on update (#119)

This is the working plan for #119. The last commit of the PR deletes it.

## Goal

Each change to a stored format comes with a dated migration. Eva records the ids that ran, and runs the missing ones at start. The machine store runs on every computer. The vault store runs on the hub only. A computer whose Eva does not know a vault migration stops writing the vault files and alerts the phone.

## Steps

1. Add `src/core/migrations/migration-runner.ts`: the `Migration` type, the record file (`{ applied: [{ id, at, version }] }`), and `runMigrations`.
   - Run the missing ids in id order. Record each id as soon as it succeeds, so a stopped run is safe.
   - A migration writes through a context. The context keeps a `<file>.<id>.bak` copy before the first change, writes with `writeFileAtomic`, and refuses a file outside its store.
   - A failed migration restores its files from the copies, is not recorded, and stops the run. The result names the id and the error.
   - When the record lists an id that this Eva does not know, run nothing.
2. Add `vaultMigrationsAhead(vaultPath, knownIds)`: the unknown ids in `.eva/migrations.json`, and the newest version that recorded one.
3. Port `moveSettingsToVault` and `moveSecuritySettingsFromVault` as the first migrations, with fixture tests. Each is idempotent, and finds nothing to move on a fresh install.
4. Wire `src/main.ts`: after the vault pull and the hub claim, run the machine migrations, then the vault migrations on the hub. Remove the two calls by hand. Log each result, and send an alert for each failure.
5. Gate the vault writes of settings, schedules and the hub claim: when the vault is ahead, refuse with a new `EvaError` code, and report one alert.
6. Add one line to the `write-commit` skill: a format change needs a migration, or a `!`. Update `AGENTS.md` ("Renames") to point at migrations.

## Gaps and decisions

1. **Both existing moves write both stores.** Split them into four migrations. Each one is frozen: it copies its key lists and works on raw JSON.
   - Machine `move-shared-settings-to-vault`: when `.eva/settings.json` exists, drop the shared keys from `config.json` (the vault wins, as today). Without a vault, it is done. With a vault but no settings file, it waits ("later"), and the values in `config.json` still work.
   - Vault `start-vault-settings`: when `.eva/settings.json` is missing, the hub starts it from its own `config.json`. A vault migration may read the machine files of the hub.
   - Machine `copy-security-settings-from-vault`: copy each security key that `config.json` lacks. A bad value is dropped, so Eva still starts.
   - Vault `drop-security-settings-from-vault`: the hub drops the security keys from the vault file. A satellite that copies after this falls back to the narrow defaults: it fails safe, as the original move accepted.
   - On the hub, the machine store runs before the vault store.
2. **A satellite runs no Telegram bot.** Report the problem through the alert center. On the hub it reaches Telegram. On a satellite it reaches the status, the web app and the log, as a vault sync problem does today. The PR says so. A relay through the vault is new design for a later issue.
3. **The gate and the import cycle.** The migrations import only `src/shared/` and the runner, so the low-level writers can import the gate: `saveSettings` (only the vault part: a machine-only change still saves), the schedule file writes, and the hub claims. The gate reads `.eva/migrations.json` at each write and throws `EvaError("vault_ahead")`. An Assistant agent can still edit the files directly.
4. **#97.** PR #115 is open. `migrationsAhead` returns the version that the vault needs. If #115 merges first, wire the rule into the updater here. Otherwise, comment on #115.
5. **The `.bak` copies** go to `state/migration-backups/<id>/<store>/` in the machine's home. A copy in the vault would sync, with the security settings. Git history backs up the vault too.
6. **Notice a vault that moved ahead** after each pull (in `logSyncState`) and at start, with one `vault_ahead` alert that resolves after the update. A machine that becomes the hub runs the vault migrations; a machine that is behind cannot claim the hub.
7. **Start order.** Take the instance lock before the migrations, so a second start never migrates under a running Eva. Hold the results, and report them after the Telegram bot starts.
8. Update `AGENTS.md` ("Renames"): a format change needs a migration, or a `!`. Lesson 54 stays as history.
