# The vault names its hub; no machine sets a role

## Context

Only one machine may run the Telegram bot and the schedules for a vault. Two bots on one token fight (lesson 56), and two schedulers fire each schedule twice. The role used to be a setting in each machine's `config.json`, with `hub` as the default, so a second machine became a second hub unless the person knew to change it. The owner wants each machine to work with no settings (plug and play), and the hub to be easy to move.

Source: owner requests of 2026-10-17; lesson 56.

## Decision

- **The vault holds the claim,** in `.eva/hub.json`: the hub's machine name and the time of the claim. `machineName` in `config.json` names a machine; its default is the host name.
- **The first machine claims the hub,** at start, after a vault pull, when the file is missing. The pull comes first, so a machine never claims over a claim that another machine already pushed.
- **Any machine takes the hub over** with `eva hub` or the web UI button. It writes the claim and pushes at once.
- **The role is live.** Each machine reads the claim on each background tick. When the role changes, the scheduler follows on its next tick, and `main.ts` starts or stops the Telegram bot. No restart.
- **Telegram has no on/off switch.** The hub runs the bot whenever it has a token.
- **A broken claim file keeps each machine's last role.** A machine that starts with a broken file is a satellite, and claims nothing. A missing file means "no claim"; a broken file can hide one, and "hub" on every machine gives two bots. `eva hub` writes a good file.
- **Without a vault, a machine is its own hub.** Two instances with different vaults on one machine each claim their own vault's hub.

**Rejected alternative:** a `role` setting in each machine's config. Every new machine had to change it, and a forgotten change gave two hubs.

## Consequences

**Positive:**

- A new machine needs no role setting, and never becomes a second hub.
- The hub moves from either machine, and the old hub stops by itself.

**Trade-offs and follow-up:**

- The old hub runs until its next vault fetch (5 minutes by default), so a schedule can fire on both machines in that window.
- Two machines that start for the first time at the same moment can both claim; the second push then conflicts, and the person resolves it once.
- Two instances with the same vault on one machine share a host name; give one a `machineName`.
