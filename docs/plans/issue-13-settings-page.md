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
   - Allowed Tailscale identities, read-only (see G5).
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

Three research agents (two mid-tier, one upper-tier) agreed on every gap. None needs the owner.

- **G0 (found in research). A device login changes only the page's settings.** Today
  `PUT /api/settings` takes any key from any login, so a device login can change
  `remoteAccess.*`, `trust`, `telegram.allowedChatId`, the executables and `vaultPath`. Fix:
  a request that logged in with a device cookie may change only an allowlist: the vault's shared
  keys, `sync`, `projectRoots`. Any other key fails with a new `EvaError` code, `setting_forbidden`
  (HTTP 403). A token login (the CLI's bearer token, or the token cookie) may change every key, so
  `eva settings set` keeps working. An allowlist protects each new key by default.
- **G1. Secrets.** Write-only `PUT /api/secrets/<name>` and `DELETE /api/secrets/<name>` for
  `githubToken`, `telegramBotToken` and `claudeOauthToken` only. The core adds the value to the
  redactor first, then saves `secrets.json`. The value never comes back. The running Eva keeps its
  copy for the checks, so Test checks the saved value at once. The git and engine environments and
  the Telegram bot read the secrets at start, so the answer says "Restart Eva to use it". A live
  pick-up needs a refactor of the preparers and is not worth it now. Review round 1 changed one
  part: only a token login may save or remove a token. A token decides whose account Eva uses, so
  a lost phone with a device login must not swap it (`setting_forbidden`, as G0).
- **G2. Vault repository.** Show the remote read-only (redacted), the folder, the existing Test
  (a push dry run, lesson 98), the fetch interval, **Sync now**, and the sync state. Changing the
  remote or cloning another vault stays in `eva setup`: a vault switch under a running sync risks
  lost changes. The sketch's "Automatically fetch" switch is the existing fetch interval dropdown.
- **G3. Telegram.** Token field with Test and the pairing state: "paired", or the pairing code
  while unpaired. The pairing code path moves into `HomePaths`, so the core can read it. No unpair
  and no chat id on the page: with the code on the page, unpair would be a takeover path.
- **G4. Engines.** Default engine and Claude Code default model (vault settings, save at once).
  Claude Code login: the write-only token from `claude setup-token` (lesson 97). pi login: pi keeps
  its own login on the machine; the page shows the command and the Test result. Never a Claude
  login for pi. The checks `claude-code` and `pi` replace `engine`. Each runs one turn through the
  engine port: project mode, untrusted, an empty temporary folder, model `default`, no prompt,
  skills or MCP servers, a deny-all approval, the engine environment, and a 90 s timeout. It
  passes on `turn_finished` and shows the start of the redacted reply. An engine that Eva did not
  find says so.
- **G4b. GitHub Test.** Today it runs `gh auth status`, but Eva's git uses the saved token. The
  check now asks the GitHub API who the token belongs to (`GET /user`, with a base URL seam). With
  no saved token, it falls back to `gh auth status`.
- **G5. Allowed Tailscale identities.** Read-only on the page, with the `eva settings set` line
  for this machine. G0 blocks it from a device login. A phone path (Telegram Allow) belongs to #42.
- **G6. Appearance.** Theme (system, light, dark) and density (comfortable, compact) per browser
  in `localStorage`, read in try/catch, applied as `data-theme` and `data-density` on `<html>`.
  Density depends on the screen, so a vault key would be wrong for a phone and a desktop at once.
- **G7. Save model.** Dropdowns save at once. Text fields wait for Save. Each secret field has
  its own Save and Remove, then Test. The notice says "Restart Eva" only when the answer has
  `restartNeeded`.

## Follow-ups (not in this PR)

- Switch the vault or clone a first vault from the page.
- A pi login from the phone.
- Change the allowed Tailscale identities from the phone through a Telegram Allow (#42).
