# Plan: fail a PR that breaks a stored name without a `!` commit (#98)

## Why

The release workflow raises the major version only for a `!` commit or a `BREAKING CHANGE:` footer. A forgotten `!` ships a breaking change as a minor release. The update policy of #97 then installs it by itself.

## Design

1. `scripts/stored-names.ts` collects every name that a person's data or fingers depend on:
   - Machine files: `config.json` and `secrets.json` (zod schemas in `src/core/settings/home.ts`), `state/sessions.json` (`src/core/sessions/session-store.ts`), `state/devices.json`.
   - Vault files: `.eva/settings.json` (the shared keys of `src/core/settings/settings.ts`), `.eva/schedules.json`, `.eva/hub.json`.
   - Typed names: the CLI commands and flags (`src/frontends/cli/arguments.ts`), the Telegram commands (`telegram-bot.ts`).
   - The ids of the known migrations (`src/core/migrations/migrations.ts`).
2. Each zod schema gives its key paths and its enum and literal values, such as `updates.install=minor`. A removed enum value breaks a read too.
3. The script writes the names to `scripts/stored-names.txt`, one per line, sorted. A unit test fails when the file is stale.
4. `scripts/check-stored-names.ts` reads the snapshot at the merge base with `origin/main`, and compares it with the names on `HEAD`. It runs in `check:static`, next to `commits`.
5. A removed stored name passes when the branch adds a migration id, or a commit is breaking (`commitChange` of `release-version.ts`). A removed CLI or Telegram name passes only with a breaking commit. Added names never fail.

## Gaps and decisions

- **Setting keys.** The issue lists them as typed names. Issue #119 says a moved setting with a migration breaks nothing. Decision: a setting key is a `config.json` key, so a migration covers it.
- **Files without a zod schema** (`hub.json`, `devices.json`, `schedules.json`). Decision: list their fields in the script, typed against the code's interfaces, so a new field fails the typecheck until it is listed. Schedules reuse `scheduleFieldOrder`.
- **Which migration covers which name.** Decision: any new migration covers any removed stored name. Simple, and a reviewer reads the migration.
- **CLI commands sit in a `switch`.** Decision: add a `cliCommands` list in `arguments.ts`. The parser rejects a first word that is not in it, so the list stays complete.
- **No snapshot at the merge base** (this PR). Decision: the check passes and says so.
- **Branch name.** The session runs on a branch that the harness named, so the work stays on it.

## Also

- One line in `src/core/updates/AGENTS.md` about the release asset names, `SHA256SUMS` and the key.
- The breaking-change line of `.agents/skills/write-commit/SKILL.md` gets the definition of the issue.
