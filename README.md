# Eva

Eva is a personal "super harness": one service that runs AI coding agents over your notes and your projects. You reach her from a terminal, Telegram, or a web page.

Eva keeps your notes in a private git repository (the vault) and saves them for you. She opens each project in its own clone, so a coding agent works there exactly as if you had opened the folder yourself. She runs Claude Code today, and pi as a fallback for other AI subscriptions.

**Status:** under construction. The core, the terminal chat, Telegram, the web page, schedules, files and voice notes work with test doubles. No release exists yet.

## Install

Download the executable for your machine from [GitHub Releases](https://github.com/guplem/eva/releases): `eva-windows-x64.exe`, `eva-linux-x64` or `eva-linux-arm64`. You also need [git](https://git-scm.com/). Then run:

```bash
eva setup
```

`eva setup` asks for each setting. You install only Eva:

- **An existing vault:** give its repository (for example `https://github.com/you/vault`) and a GitHub token that can read and write it. Eva checks that git can read the repository, and asks again with git's reason when it cannot. Then she clones the vault into her home folder and keeps it in sync. The token stays in Eva's `secrets.json`; it is in no git file.
- **A new vault:** give no repository. Eva creates a vault from her template, with a private GitHub repository when you name one.
- **The time zone** is your computer's, unless you type another one. **The port** is a free one; change it later with `eva settings set port <number>`.

Then run `eva service install`. Eva starts at once, and again each time you log in.

For a script, such as a server install, run `eva setup --non-interactive` and give each answer in an `EVA_*` variable, for example `EVA_VAULT_REPOSITORY`, `EVA_GITHUB_TOKEN`, `EVA_CLAUDE_TOKEN`, `EVA_TELEGRAM_BOT_TOKEN` and `EVA_TELEGRAM_CHAT_ID`. `src/frontends/cli/setup.ts` lists every name.

## Open Eva

Eva has one address for all your devices, such as `https://server.your-tailnet.ts.net`. It opens her web page on your phone or any computer, from anywhere, with no login. The page is never on the public internet: only your own devices reach it, through [Tailscale](https://tailscale.com) (a free private network between your devices).

**Find the address** in any of these places:

- Ask Eva in any chat: "what is your address?"
- Telegram: `/link`.
- The Settings page, under Setup.
- On the machine that runs Eva: `eva link` or `eva status`.
- The last step of `eva setup` prints it.

**Open it on a phone or another computer:**

1. Install the Tailscale app, and sign in with the same account as the machine that runs Eva.
2. Open the address. Tailscale proves who you are, so Eva asks for no login.

A device without Tailscale cannot reach Eva. Remove a borrowed device from the Tailscale admin page (Machines, then Remove) when you are done with it.

**Set it up once, on the machine that runs Eva.** `eva setup` guides you through each step and waits for you:

1. Install Tailscale on the machine. On Linux with `sudo`: `curl -fsSL https://tailscale.com/install.sh | sh`. Without `sudo`, see [Tailscale without root](#tailscale-without-root).
2. Sign in: setup prints a link; open it on any device.
3. Turn HTTPS on for your tailnet, once: setup prints the page.
4. Setup prints the address. From then on, Eva publishes it each time she starts (`tailscale serve`).

**Advanced: on the machine that runs Eva.** The same page also listens at `http://127.0.0.1:7420` (or the instance's port), on that machine only. There, no Tailscale proves who you are, so the page asks once for the token `localApiToken` from `secrets.json` in Eva's home folder; the login lasts a year. The `eva` commands on that machine read the token by themselves.

Only the Tailscale account that owns the machine gets in. To let other accounts in, list them all in `remoteAccess.allowedTailscaleIdentities`. To keep Eva off the tailnet, run `eva settings set remoteAccess.tailscaleServe false`.

### Tailscale without root

Tailscale runs as a normal user in its userspace mode. Download the static build for your machine from [pkgs.tailscale.com](https://pkgs.tailscale.com/stable/#static), and put `tailscale` and `tailscaled` in `~/.local/lib/tailscale/`. Then:

1. Create `~/.local/bin/tailscale`, so every command finds the user's own socket, and make it executable:

   ```bash
   #!/bin/sh
   exec "$HOME/.local/lib/tailscale/tailscale" --socket="$HOME/.local/share/tailscale/tailscaled.sock" "$@"
   ```

2. Create `~/.config/systemd/user/tailscaled.service`:

   ```ini
   [Unit]
   Description=Tailscale for this user
   After=network-online.target

   [Service]
   ExecStart=%h/.local/lib/tailscale/tailscaled --tun=userspace-networking --statedir=%h/.local/share/tailscale --socket=%h/.local/share/tailscale/tailscaled.sock
   Restart=on-failure

   [Install]
   WantedBy=default.target
   ```

3. Run `systemctl --user enable --now tailscaled`, then `tailscale up`, and open the link that it prints.

## Run from source

You need [git](https://git-scm.com/) and [Bun](https://bun.sh/) 1.4 or newer.

```bash
git clone https://github.com/guplem/eva.git
cd eva
bun install
bun run eva
```

| Command                                                 | What it does                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bun run eva setup`                                     | Asks for each setting (vault, tokens) and writes the config.                                                   |
| `bun run eva doctor`                                    | Checks the tools that each feature needs, and says how to install each.                                        |
| `bun run eva`                                           | Runs Eva in the foreground: the local web page, Telegram, and schedules.                                       |
| `bun run eva chat`                                      | Talks to a running Eva in this terminal.                                                                       |
| `bun run eva service install`                           | Starts Eva now, and by herself each time you log in.                                                           |
| `bun run eva setup --non-interactive`                   | Reads each answer from an `EVA_*` variable instead, for scripts. `src/frontends/cli/setup.ts` lists the names. |
| `bun run eva status`                                    | Shows the engines, the vault sync and the sessions.                                                            |
| `bun run eva projects [words]`                          | Searches the projects.                                                                                         |
| `bun run eva work <project> <request>`                  | Gives work to a project. A Project chat in a free clone runs it.                                               |
| `bun run eva update [--check]`                          | Installs the latest version, then restarts. `--check` only looks.                                              |
| `bun run eva sync`                                      | Brings the vault's remote changes in, then saves and pushes this machine's changes.                            |
| `bun run eva hub`                                       | Makes this machine the hub, which runs Telegram and the schedules.                                             |
| `bun run eva link`                                      | Shows the address that opens Eva on your phone and other computers.                                            |
| `bun run eva settings [get <key> \| set <key> <value>]` | Shows or changes a setting.                                                                                    |

## Settings

Eva keeps two kinds of settings:

- **Your settings live in your vault,** in `.eva/settings.json`, so every machine with the vault uses the same ones: the time zone, updates, the vault fetch, the default engine and model, trust, Google, and the voice language.
- **This machine's settings live in Eva's home folder** (`~/.config/eva` on Linux, `%APPDATA%\eva` on Windows): `config.json` holds the vault folder, the machine name, the port, the project roots, the program paths, the Telegram chat, the remote host names, `remoteAccess.tailscaleServe`, and `secrets.json` holds the tokens. Tokens never go in the vault.

An older `config.json` moves your settings to the vault by itself at the next start. Change a setting on the web Settings page, or with a command, while Eva runs or not:

```bash
eva settings
eva settings get updates.frequency
eva settings set updates.frequency weekly
```

`eva settings` lists every setting and marks the vault's settings with `(vault)`. The update frequency and the vault fetch apply at once; any other change applies at the next restart.

## Machines and the hub

Eva works on several machines with one vault, with no role to set. One machine is the **hub**: it runs the Telegram bot and the schedules. Every other machine is a **satellite**: it syncs the vault and serves its own terminal and web page.

- **The first machine that starts with the vault becomes the hub.** The vault names it in `.eva/hub.json`.
- **Move the hub** with **Make this machine the hub** on the Settings page, or `eva hub` on the new machine. The old hub stops its bot and schedules at its next vault fetch.
- **The bot runs on the hub whenever the hub has a Telegram token.** A satellite never starts it, even with the token.
- **Two Evas on one machine** work too: give each its own home folder (`--home`) and vault. `eva service install` names each service after its home folder, for example `eva-partner`. An Eva whose home folder is not the default one keeps her own Claude and `gh` logins in `<home>/engines/claude` and `<home>/engines/gh`, so two people never share a login. Give her a Claude token in `eva setup`, and log her `gh` in with `GH_CONFIG_DIR=<home>/engines/gh gh auth login`.
- **Phone access** needs no setting: see [Open Eva](#open-eva).

## Updates and vault sync

- **Updates:** Eva looks for a new version every day by default (`updates.frequency`: `off`, `hourly`, `daily` or `weekly`). She installs it only when no chat is running, then restarts. The single executable takes the latest signed release. An install from source takes the newest commit of `main`, and runs `bun install` when the dependencies changed; it never touches a checkout with local changes, its own commits, or another branch. Update now with the **Update now** button on the Settings page, Telegram `/update`, or `eva update` (`eva update --check` only looks).
- **Vault sync:** Eva pulls the vault before each Assistant turn, saves and pushes after it, and fetches other machines' changes every 5 minutes (`sync.pullIntervalMinutes`; `null` means only before each turn). Sync now with the **Sync now** button, Telegram `/sync`, or `eva sync`.

## Install on a Linux server

These steps install Eva for one user, with no `sudo`. Run them as that user, for example over SSH. They need `git`, `curl` and `python3`.

1. Install Bun. The official script needs `unzip`; without it, unpack the release with Python:

   ```bash
   mkdir -p ~/.bun/bin && cd /tmp
   curl -fsSL -o bun.zip https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64.zip
   python3 -c "import zipfile; zipfile.ZipFile('bun.zip').extractall('.')"
   mv bun-linux-x64/bun ~/.bun/bin/ && rm -r bun.zip bun-linux-x64
   echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc && export PATH="$HOME/.bun/bin:$PATH"
   ```

2. Install Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`), then get Eva:

   ```bash
   git clone https://github.com/guplem/eva.git ~/eva
   cd ~/eva && bun install --frozen-lockfile --production --ignore-scripts
   ```

3. Set Eva up in one command. Eva clones the vault herself. An SSH address (`git@github.com:you/vault.git`) uses the machine's SSH key; an HTTPS address uses `EVA_GITHUB_TOKEN`.

   ```bash
   EVA_TIME_ZONE="Europe/Madrid" \
   EVA_VAULT_REPOSITORY="git@github.com:you/vault.git" \
   EVA_GITHUB_TOKEN="..." \
   EVA_CLAUDE_TOKEN="..." \
   EVA_TELEGRAM_BOT_TOKEN="..." \
   EVA_TELEGRAM_CHAT_ID="..." \
   bun run src/main.ts setup --non-interactive
   ```

4. Start Eva with the system. The command starts her now, and runs `loginctl enable-linger` so she keeps running after you log out. When that step fails, it prints the command for an administrator.

   ```bash
   bun run src/main.ts service install
   ```

5. Check her: `bun run src/main.ts status`. The log is in `~/.config/eva/logs/`. Then write to your bot in Telegram.

Eva updates herself from then on (see [Updates and vault sync](#updates-and-vault-sync)). For a private copy of the repository, she uses the GitHub token from setup.

## Optional features

Each feature below stays off until you set it up. `eva doctor` shows which tools are missing.

- **Schedules.** Ask Eva for a reminder or a daily summary, or use **Add schedule** on the Settings page. Eva writes `.eva/schedules.json` in the vault. Before a schedule first runs, Telegram shows a setup card with every field: check it. Only the hub runs schedules (see [Machines and the hub](#machines-and-the-hub)).
- **Files.** Eva can send a vault file in Telegram, and saves each file that you send her in `Scratch/received/` in the vault. Git never saves `Scratch/`, and Eva deletes its files after a week.
- **PDFs.** Install [typst](https://github.com/typst/typst/releases). Eva then writes a PDF in `Scratch/` and sends it.
- **Voice notes.** Install [ffmpeg](https://ffmpeg.org/download.html) and [whisper.cpp](https://github.com/ggml-org/whisper.cpp), download a model (for example `ggml-base.bin`), and put the model at `voice/ggml-base.bin` in Eva's home folder. Eva finds it there; for another place, run `eva settings set voice.modelPath <file>`. The audio never leaves the machine.
- **Google (Calendar, Drive, Contacts, Tasks).** Install [uv](https://docs.astral.sh/uv/). Create an OAuth client in Google Cloud, of type "Desktop app", and set its publishing status to "In production" so that the login does not expire after 7 days. Put its id and secret in `secrets.json` as `googleOauthClientId` and `googleOauthClientSecret`, and your account with `eva settings set google.email <address>`. The first Google request gives you a link to log in. Eva starts with read-only access; set `google.readOnly` to `false` to let her add events. She asks you before any change that reaches other people, such as an invitation.

## Develop

| Task                       | Command                 |
| -------------------------- | ----------------------- |
| Install the git hooks once | `bunx lefthook install` |
| Run every check            | `bun run check`         |
| Format the code            | `bun run format`        |
| Run the tests              | `bun test`              |

`bun run check` runs the same checks as the continuous integration (CI) on every pull request: format, lint, types, architecture rules, dead code, a personal-data check, and the tests with coverage.

## Documents

| Document                                               | What it holds                                   |
| ------------------------------------------------------ | ----------------------------------------------- |
| [docs/intent.md](docs/intent.md)                       | What Eva must achieve, and why                  |
| [docs/plan.md](docs/plan.md)                           | The design and the phases                       |
| [docs/standards/](docs/standards/README.md)            | How the code is written                         |
| [docs/lessons-from-v1.md](docs/lessons-from-v1.md)     | What the previous version, Wall-I v1, learned   |
| [docs/review-2026-10-14.md](docs/review-2026-10-14.md) | The review of the plan, and the owner's answers |
| [docs/spikes.md](docs/spikes.md)                       | Small real tests of claims the plan relies on   |
| [docs/mockups/](docs/mockups/)                         | Sketches of the app                             |

## License

MIT. See [LICENSE](LICENSE).
