# Plan: a new vault structure shows as a warning (#801)

Builds on #800, which maps each problem key to the Settings card that fixes it (`problemSettingsRoute`).

## Motivation

The owner updated Eva and did not notice the vault structure news (#773), nor the Settings card. A news entry sits in "Earlier" and is easy to miss. He asked for a warning in the notification center, a button that opens Settings > Vault and sync > Vault structure, and a "mark as read" that stops it for that version.

## Steps

1. **Alert center:** add `notice(key, problem, send)`: an open warning with no reminder. `send` sends it to the phone and adds its history entry; without it, the warning opens silently (after a restart). `dismiss` closes it with no "resolved" alert.
2. **Eva (hub):** `reportVaultStructure` replaces `announceVaultStructure`. When the vault is older than the newest structure and the person has not read the warning of that version, it opens the warning: sent when the version is not announced yet, silent when it is. Otherwise, and on a satellite, it dismisses it. It runs at start, when the machine becomes hub or satellite, and after each `eva vault-upgrade` step (finish clears it, undo brings it back).
3. **Mark as read:** `hideProblem("vault_structure")` and "Mark all as read" record the version as read in the hub's structure notices file (`read`, beside `announced` and `prompted`), mark the entries read, and close the warning. It does not come back for that version, also after a restart or an undo.
4. **Web:** `problemCards.vault_structure` opens the `vault-structure` card. The "Update the vault" action of the entry goes: an old news entry gets "Open Settings" too, while the upgrade is open to this computer. The notification details text follows.
5. **Words:** the warning says "A new vault structure (version 3) is ready. Your vault is at version 2. To update it, open Settings, Vault and sync, Vault structure, or ask the Assistant." Telegram keeps its button and reply. The guide follows.

## Gaps and decisions

- **Which kind of alert.** A problem through `report` repeats every 24 hours and alerts again after each restart; a one-off `notify` entry stays in "Earlier", where the owner missed it. Decision: the smallest addition, `notice`, an open warning in "Needs you" that is sent once. Reason: the issue asks for no reminders and one phone message, and for a warning that marking read removes.
- **"Mark as read removes it".** A read problem stays listed in "Needs you". Decision: the vault structure warning closes when read, and the read version lives in the hub's structure notices, the file that already holds `announced`. Reason: the done-when says it is removed and stays gone for that version; one file holds every fact about this notice, and no hidden mark is needed.
- **Undo after a read warning.** Decision: it stays gone (the version is read). Reason: the issue brings it back only "while the person has not marked it read".
- **The summary of changes in the message.** Decision: left out; the card shows it. Reason: a short line in the center; the upgrade chat explains every change first.
- **Old news entries** from #773 keep their key and level, and get "Open Settings" instead of "Update the vault". Reason: one way in, the card. Stored names do not change: key `vault_structure`, level `warn` already exists, and an older Eva reads both. The notices file keeps unknown fields readable; an older Eva that rewrites it drops `read`, so the warning would show again once, silently.
- **Telegram:** unchanged (button and reply), as the issue says. A "resolved" alert never comes for this key, since `dismiss` sends none.
