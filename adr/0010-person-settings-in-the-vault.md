# A person's settings live in the vault; a machine's settings and secrets stay in the instance home

## Context

A person runs Eva on more than one machine: a hub server and a PC with a clone of the same vault. When every setting lived in each home's `config.json`, a change such as the time zone or the update frequency had to be made on each machine, and the copies drifted. The vault already syncs between those machines, and it already holds Eva's other files for the person (`.eva/assistant.md`, `.eva/schedules.json`).

Source: plan §1 (D14), §4.4; owner request of 2026-10-17; lesson 54.

## Decision

- **Two files.** The person's settings live in the vault, in `.eva/settings.json`. The machine's settings stay in `<home>/config.json`. One schema covers both; `sharedSettingKeys` in `src/core/instance/settings.ts` lists the vault's keys.
- **The vault's keys:** the time zone, updates, the vault fetch and save intervals, the default engine and model, pi's models, trust, Google, the voice language, the allowed Tailscale identities. **The machine's keys:** the vault folder, the machine name, the port, the project roots, program paths, the Telegram chat, remote host names. Each has a default that Eva finds on the machine (plan §4.4, "Plug and play").
- **Secrets never go in the vault.** They stay in `secrets.json`.
- **The vault wins.** Eva reads `config.json`, then puts the vault file on top. A machine key in the vault file is ignored.
- **A broken vault file never stops Eva** (lesson 54). It can arrive from another machine, so Eva logs the problem and keeps `config.json`.
- **Every write splits.** `saveSettings` writes the vault's part to the vault and the rest to `config.json`. Without a vault, everything stays in `config.json`.
- **Migration at start.** Eva pulls the vault first, then moves the vault's keys out of an older `config.json`. When the vault already has the file, the vault wins. The pull comes first, so two machines never each start the file and conflict.

**Rejected alternative:** the vault holds every setting. The vault folder itself, the port and the program paths differ by machine, and the vault folder must be known before the vault can be read.

## Consequences

**Positive:**

- One change applies on every machine after the next vault sync.
- `eva setup` on a new machine with an existing vault takes the person's settings from the vault.

**Trade-offs and follow-up:**

- A change from another machine applies at the next restart; only the update frequency and the vault fetch apply at once on the machine where they change.
- Eva's autosave commits each settings change to the vault, like any other vault file.
