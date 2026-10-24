# Claim the hub after a later real fetch (#529)

## Why

A start that cannot pull the vault does not claim the hub. Nothing tries again until the next start. A machine with no `hub.json` reads as the hub, so it can run as an unclaimed hub for days. A second machine can then claim too.

## Plan

1. `VaultSync` counts each fetch that worked. A pull that skips the fetch, such as with an unpushed merge commit, does not count.
2. `VaultUpkeep` gets an `afterFetch` option. It runs only when a step fetched and the pull ended `ok`:
   - the timed pull (`pullIfDue`), which already needs `sync.enabled` and no Assistant turn;
   - "Sync now", between the pull and the save, so the save pushes the claim at once. It runs only with `sync.enabled` on.
   - Never after the pull before an Assistant turn, `conflicts()`, `resolve()` or the sweep.
   - It checks again for an Assistant turn after the fetch, because a turn can start while git runs.
3. Eva passes `afterFetch` that calls `claimHubIfUnclaimed`, and logs the claim. A full disk logs a warning and does not stop the sync.

## Decisions

- **The vault migrations do not wait for the claim.** This is the behavior on `main`: a vault with no `hub.json` reads as the hub, so the start runs the vault migrations. A later claim keeps the role "hub", so nothing more must run. `becomeHub` and `eva hub` on a running Eva change the role from satellite to hub, and `noticeRoleChange` runs the vault migrations. `eva hub` with no running Eva claims, and the next start runs them.
- **Respect `sync.enabled` in "Sync now"** for the claim, as the issue asks. The person can still claim with `eva hub` or the web.
- **No flag from the start.** `claimHubIfUnclaimed` does nothing when `hub.json` exists, so the retry needs no memory of the start.

## Out of scope

- A vault with no `origin` where `git remote` failed at start. The pull never fetches there, so only the next start claims.
