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

## Gaps

1. Both existing moves write both stores. How do they split into machine and vault migrations?
2. A satellite runs no Telegram bot. How does its alert reach the phone?
3. Where does the vault write gate live, without an import cycle (settings, hub and schedules on one side, the migration list on the other)?
4. #97 (PR #115, open) and #119 interact (see the comment on #119). Which part lands here?
5. Where do the `.bak` copies of vault files go: next to the file, in the vault, or in the machine's home?
6. When does a running Eva notice that the vault moved ahead after a pull?
