# Owner to-do

Steps that only the owner can do. The implementing agent adds a line when it reaches such a step, and continues with fakes. Tick a line when it is done.

## Machines

- [ ] **Server laptop:** turn it on, then stop and disable the v1 service (`systemctl --user disable --now walli-server`), point its clone at the vault (`git -C ~/Wall-I remote set-url origin git@github.com:guplem/vault.git`), and push any notes it holds.
- [ ] **Other machines with a vault clone:** list them, and point each one at `guplem/vault`.

## Logins and tokens

- [ ] **The v1 `.env` on this PC is gone.** The agent deleted `notes/server/` in the vault restructure (2026-10-14), and its untracked `.env` with it. It held the Telegram bot token, the allowed chat id, a `claude setup-token` token and an Anthropic API key. Nothing was revoked, so every value still works. Copy them from the server laptop (`~/Wall-I/server/.env`), or create them again: BotFather `/token`, `claude setup-token`, the Anthropic console. Then give them to Eva with `bun run eva setup`.

- [ ] **Claude login on this PC:** the standalone `claude` is not logged in (the desktop app uses its own login). Run `claude` once and log in, or run `claude setup-token` and give the token to Eva in `eva setup`.

## Decisions with a default

- [ ] **`online-sync`:** its own project, or part of Ghana Ludo (default)?
