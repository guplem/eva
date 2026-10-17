# Eva updates herself at a set frequency, only when idle, and restarts

## Context

A server install had to be updated by hand over SSH: `git pull`, `bun install`, then a service restart. A person who forgets runs an old Eva for months. A restart in the middle of a turn would also cut the turn off.

Source: plan §1 (D15), §11, §12; owner request of 2026-10-17; lesson 89.

## Decision

- **One updater, two channels.** `Updater` in `src/core/updates/updater.ts` decides when; an `UpdateChannel` decides how. The single executable uses the signed GitHub releases (`executableUpdateChannel`). A source checkout uses git (`sourceUpdateChannel`).
- **The pace is a setting.** `updates.frequency` is `off`, `hourly`, `daily` (default) or `weekly`. A background tick each minute checks when a check is due. A manual update (`eva update`, Telegram `/update`, the web button) checks at once.
- **Install only when idle.** When a chat runs a turn, the update waits, and the next tick that finds Eva idle installs it.
- **Restart with exit code 4.** systemd starts Eva again (plan §4.3). Without a supervisor, such as a Windows logon task, Eva first starts a new copy of herself, and the new copy waits for the old process to exit before it takes the instance lock.
- **A source checkout updates only safely.** It fast-forwards to its remote default branch, whose commits passed CI. It refuses on local changes, its own commits, or another branch. It runs `bun install` only when `package.json` or `bun.lock` changed, keeps the kind of install (production or development), and goes back to the old commit when the install fails.
- **A private engine repository works.** The source channel uses Eva's GitHub credential helper, like the vault clone (lesson 96).

**Rejected alternative:** an update at the moment it is found. It would restart Eva in the middle of a turn.

## Consequences

**Positive:**

- A server stays current with no SSH session.
- The CLI, Telegram and the web UI share one update path in the core.

**Trade-offs and follow-up:**

- A bad commit on `main` reaches every source install within a day. CI on Ubuntu and Windows is the gate.
- No automatic rollback after a start that fails; the old executable stays beside the new one (`.old`), and git keeps the old commit.
