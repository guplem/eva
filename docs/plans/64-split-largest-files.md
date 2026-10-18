# Plan: split the three largest files (#64)

This is a working plan. It goes away before the merge.

## Goal

Each of `src/frontends/telegram/telegram-bot.ts`, `src/core/eva.ts` and `src/main.ts` gets one clear job.
Logic leaves `src/main.ts` for modules that have tests.
Behaviour stays the same, and `bun run check` passes.

## Constraints

- The layer rules hold: the core imports only `src/shared/`, a front end never imports an engine, and only `src/main.ts` joins every layer.
- The public API of `Eva` and `TelegramBot` stays the same, so the front ends and the tests keep working.
- Stored names stay the same: no config key, state file field, event `kind` or error code changes.
- Each new module has tests. A pure move keeps its tests where they are, and the commit says so.

## Steps

### 1. `src/frontends/telegram/telegram-bot.ts` (1164 lines)

The bot keeps the update handling: commands, buttons, topics and session events.

- `telegram-messages.ts`: the Telegram update and message types, and the pure helpers that read them (`receivedFileOf`, `unreadableContentOf`, `keyOf`, `threadOf`, `titleOf`).
- `telegram-sender.ts`: a `TelegramSender` class that sends text and HTML answers, retries after a 429 or a network error, and logs a failed call.
- `telegram-poll.ts`: the poll state, the 409 conflict window, the retry backoff and the poll alert.
- `telegram-texts.ts`: the command list and the texts that the bot builds (schedule card, project list, approval answer).
- `telegram-state.ts`: the bot state file (load and save).

### 2. `src/core/eva.ts` (1128 lines)

`Eva` stays the facade that every front end talks to, and keeps its methods. It delegates to:

- `core/instance/child-environments.ts`: the git, engine and engine-tool environments, and the `eva` scripts for agents.
- `core/projects/project-work.ts`: the clone choice, project chats, project work and its report, and the repository setup report.
- `core/settings/settings-service.ts`: the public settings, a settings change, a page secret and the setup state.
- `core/vault/vault-upkeep.ts`: the sync now, the idle sweep, the timed pull and the sync alert.

The types that front ends import move with their logic. The importers change to the new path.

### 3. `src/main.ts` (801 lines)

`src/main.ts` keeps only wiring: the process facts, the engines, the `run` wiring and the exit code of an error.

- `frontends/cli/host.ts`: a `CliHost` with the process facts (environment, platform, home, runner, output). Helpers build the child and git environments and find a running Eva.
- `frontends/cli/commands.ts`: the command dispatch, `doctor`, `setup` and the client commands (`status`, `projects`, `chat`, `work`).
- `frontends/cli/local-commands.ts`: `update`, `sync`, `hub`, `link` and `settings`, through a running Eva or alone.
- `frontends/cli/service.ts`: also `service-install` and `supervise`.
- `frontends/cli/exit.ts`: the exit code and message of an error that reaches the top.
- `frontends/telegram/telegram-start.ts`: start the bot with its pairing code, and follow the hub role.
- `core/remote-access/tailscale.ts`: publish through Tailscale, and try again until HTTPS works.
- `core/instance/new-copy.ts`: the command and environment of the new copy after an update, and the wait for the old copy.
- `core/instance/startup.ts`: the start steps before the core runs (settings moves after a pull, the hub claim, the local token).
- `core/updates/update-channel.ts` or the updater: pick the executable or the source update channel.

## Gaps

To be filled by the gap review.
