# Plan: settings page sections (issue #13)

Issue: https://github.com/guplem/eva/issues/13
Owner's status comment: https://github.com/guplem/eva/issues/13#issuecomment-6238952552
Design: the owner's sketch `docs/mockups/settings.png` (commit 25c0e12). It shows token fields
with a Test button, a vault repository field, an automatic fetch switch, a Telegram bot token
field, and a harness (engine) dropdown with a Test button.

## Goal

A person never edits `config.json` or `secrets.json` by hand. Every setting that the issue lists
has a control on the settings page, and the control saves the setting.

## What exists on `main`

- Setup: vault folder, phone access, hub role, Test buttons (vault, Claude Code, gh, Telegram),
  the names of the saved secrets, time zone, vault fetch interval with **Sync now**, vault save
  interval.
- Updates: frequency, **Update now**, **Restart Eva**.
- Projects: extra project folders.
- Schedules panel (a dedicated page is issue #39, out of scope here).
- Appearance: fixed text.
- A problem banner shows a sync conflict or error (since #35).

## Steps

1. **Engine checks with a tiny real prompt.** Replace the `engine` check with one check for each
   engine (`claude-code`, `pi`). Each check runs one real turn through the engine port, in an
   empty temporary folder, with a fixed short prompt, a deny-all approval and a timeout. The
   check passes when the turn ends with `turn_finished`, and shows the start of the reply.
2. **Save secrets from the page.** A core method saves a write-only secret
   (`githubToken`, `telegramBotToken`, `claudeOauthToken`) to `secrets.json`. The value never
   comes back to the page. The running Eva uses the new value for the next check and turn.
3. **Setup section, reorganised as in the sketch.**
   - GitHub: token field (write-only) with Test.
   - Vault: repository (remote) shown, folder, Test, fetch interval, **Sync now**, save interval.
   - Vault sync state: status, last commit, last push, last error or conflict, held-back files.
   - Telegram: bot token field with Test, pairing state (paired chat, or the pairing code).
   - Engines: default engine, Claude Code default model, login step for each engine, Test for each.
   - Time zone.
   - Allowed Tailscale identities (see gap G5).
4. **Appearance: theme and density.** A theme choice (system, light, dark) and a density choice
   (comfortable, compact) that the page applies.
5. **Section order:** Setup, Updates, Appearance, Projects, then Schedules until #39 moves it.
6. **Docs:** update `docs/guide/` where it describes the settings page or `eva setup` only.

## Gaps

- **G1. Secrets from the web page.** Is it right for the page to write tokens? How does the
  running Eva pick up the new value? Can a token be cleared?
- **G2. Vault repository.** What does "saves its setting" mean for the vault repository: show
  the remote, change the remote, or clone a new vault?
- **G3. Telegram.** Token only, or also pairing (show the code, unpair, chat id)?
- **G4. Engines.** What is the "login step" for Claude Code and for pi, from a phone? Which mode,
  folder and model does the tiny real prompt use?
- **G5. Allowed Tailscale identities.** The owner warns that whoever has the page could add an
  account. Edit from the page, show read-only, or leave to issue #42?
- **G6. Appearance.** Where do theme and density live: the vault (every machine and browser) or
  each browser?
- **G7. Save model.** Which controls save at once, and which wait for the Save button?

## Decisions

To be filled after the gap research.
