# Show "sync off" in the vault status (#215)

## Motivation

With `sync.enabled: false`, the turn pull and save skip, and the vault status keeps the "ok" of the pull at start. The phone then shows "ok" while the notes of Assistant turns are not on the remote. `AGENTS.md` says every problem must reach the phone.

## Plan

- Add `vaultAutoSync: boolean` to `EvaStatus` in `src/core/eva.ts`. It is the running value of `sync.enabled`, which applies after a restart.
- `describeStatusLines` (`eva status` and Telegram /status) adds a line after the sync line when the flag is false and a vault is set.
- The Sync card of the web page shows a callout when the flag is false.
- The `VaultSyncState` fields and the sync `status` values stay the same.

## Gaps and decisions

- **A new status value "off", or a new field?** A new field. A new `status` value would change a sent name that every front end reads and that the alert rules branch on. A new field is additive: an old page ignores it.
- **An alert, or a plain line?** A plain line. Sync off is the person's choice, not a fault, so it does not count as a problem in "All good".
- **An old core with a new page.** The page reads a missing field as "on": it shows the callout only when the field is `false`.
- **The saved setting or the running value?** The running value (`options.config.sync.enabled`). A saved change waits for a restart, as the sync steps do.
