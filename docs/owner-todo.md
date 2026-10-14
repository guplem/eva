# Owner to-do

Steps that only the owner can do. The implementing agent adds a line when it reaches such a step, and continues with fakes. Tick a line when it is done.

## Machines

- [ ] **Server laptop:** turn it on, then stop and disable the v1 service (`systemctl --user disable --now walli-server`), point its clone at the vault (`git -C ~/Wall-I remote set-url origin git@github.com:guplem/vault.git`), and push any notes it holds.
- [ ] **Other machines with a vault clone:** list them, and point each one at `guplem/vault`.

## Vault (the agent may not push to it after phase P1)

- [ ] **Switch the vault to Eva's own sync:** once Eva runs on the hub, delete the temporary v1 sync hooks (`.claude/hooks/` and the hook entries in `.claude/settings.json`) from the vault, and commit. Until then both save the vault, which is harmless but double.

## Logins and tokens

- [ ] **The v1 `.env` on this PC is gone.** The agent deleted `notes/server/` in the vault restructure (2026-10-14), and its untracked `.env` with it. It held the Telegram bot token, the allowed chat id, a `claude setup-token` token and an Anthropic API key. Nothing was revoked, so every value still works. Copy them from the server laptop (`~/Wall-I/server/.env`), or create them again: BotFather `/token`, `claude setup-token`, the Anthropic console. Then give them to Eva with `bun run eva setup`.

- [ ] **Claude login on this PC:** the standalone `claude` is not logged in (the desktop app uses its own login). Run `claude` once and log in, or run `claude setup-token` and give the token to Eva in `eva setup`.

## Features (phase P6)

- [ ] **Google:** in Google Cloud, create an OAuth client of type "Desktop app" with the Calendar, Drive, People and Tasks APIs on, and set the consent screen to "In production". Add the client id and secret to Eva's `secrets.json` (`googleOauthClientId`, `googleOauthClientSecret`) and the account to `config.json` (`google.email`). Then ask Eva about the calendar once, and open the login link. A live run of a calendar write with a guest checks the approval button.
- [ ] **Voice (spike S6):** on the hub, install ffmpeg and whisper.cpp, download `ggml-base.bin` (it reads Spanish and English), and set `voice.modelPath`. Then send Eva a real voice note in Telegram and check the "Heard:" line.

## pi (phase P7)

- [ ] **A live pi turn:** install pi (`npm install -g @mariozechner/pi-coding-agent`), log in to a provider with `pi` (for example ChatGPT), set `engines.pi.model` if you want one, and set `engines.default` to `pi` for a test. Then check one Assistant turn, one tool approval and one fork. The adapter is tested only on captured output so far.
- [ ] **pskill with pi:** pskill needs a `pi` harness entry before skill runs continue on their own with pi (plan §5.4). Eva still calls pskill with `--harness claude-code`.
- [ ] **Google tools with pi:** pi has no MCP support, so the Google tools work only with Claude Code for now.

## Releases (phase P8)

- [ ] **The release signing key:** the agent generated an Ed25519 key on 2026-10-15 and stored only its private half, as the repository secret `EVA_RELEASE_SIGNING_KEY`. No copy exists elsewhere. If you want your own key, make a new pair, replace the secret, and change `releasePublicKey` in `src/core/updates/release-verification.ts` in the same pull request.
- [ ] **The first release:** when you are happy with Eva, push a tag such as `v0.1.0` (it must match `package.json`). The release workflow builds, tests, signs and publishes the executables.

## Decisions with a default

- [ ] **`online-sync`:** its own project, or part of Ghana Ludo (default)?
