# Install Eva, step by step

This guide installs Eva on the computer that stays on (the hub). It takes about 30 minutes. You type a few commands in a terminal: on Windows, open **PowerShell** from the Start menu; on Linux, open **Terminal**.

When a step says "run", type the command and press Enter.

## Before you start

Create these accounts first, in your browser:

1. **Claude** at [claude.ai](https://claude.ai), with a Pro or Max subscription.
2. **GitHub** at [github.com](https://github.com).
3. **Tailscale** at [tailscale.com](https://tailscale.com) (free). Sign in with Google, Microsoft or GitHub.
4. **Telegram** on your phone, from your app store.

## Create your Telegram bot

A bot is a Telegram account that a program controls. Eva talks to you through your own bot.

1. In Telegram, open a chat with **@BotFather** (the official bot that makes bots).
2. Send `/newbot`.
3. Give it a name, for example `My Eva`, and a user name that ends in `bot`, for example `my_eva_123_bot`.
4. BotFather answers with a **token**: a long code such as `123456789:AAH...`. Copy it. Eva asks for it during setup. Never share it: whoever has it controls the bot.

## Get your Claude token

Eva uses your Claude subscription through Claude Code, Anthropic's program for AI agents.

1. Install Claude Code:
   - Windows (PowerShell): `irm https://claude.ai/install.ps1 | iex`
   - Linux: `curl -fsSL https://claude.ai/install.sh | bash`
2. Run `claude setup-token`, and sign in when the browser opens.
3. Copy the token that it prints. Eva asks for it during setup.

## Decide where your notebook lives

Your notebook (the vault) is a private GitHub repository of notes. Choose one:

- **Start a new notebook.** Leave the repository question empty during setup. Eva creates the notebook from her template, and can create its private GitHub repository for you.
- **Use a notebook that you already have.** Give its address during setup, such as `https://github.com/you/vault`, and a GitHub token that can read and write it:
  1. Open GitHub, then **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
  2. Under **Repository access**, choose **Only select repositories**, and pick your notebook.
  3. Under **Permissions → Contents**, choose **Read and write**.
  4. Generate the token and copy it.

## Install Eva on Windows

1. Install git and Bun. Run:

   ```bash
   winget install --id Git.Git -e
   ```

   ```bash
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

   Close PowerShell and open it again, so that it finds the new programs.

2. Get Eva. Run these one by one:

   ```bash
   git clone https://github.com/guplem/eva.git
   ```

   ```bash
   cd eva
   ```

   ```bash
   bun install
   ```

3. Run the setup, and answer its questions (see [What setup asks](#what-setup-asks)):

   ```bash
   bun run eva setup
   ```

4. Start Eva, and make her start by herself each time you log in:

   ```bash
   bun run eva service install
   ```

   Windows may ask for permission. If it refuses, open PowerShell with **Run as administrator** and run the command again.

5. Pair your Telegram chat, so that Eva answers only you. Run `bun run eva status`: it shows a line such as `Telegram pairing code: send EVA-1A2B3C4D to your bot`. Send that code to your bot in Telegram. From then on, Eva answers only that chat.

## What setup asks

Press Enter to keep the value in brackets. Eva saves each answer on this computer.

| Question                    | What to answer                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| GitHub token                | The token from [Decide where your notebook lives](#decide-where-your-notebook-lives), or Enter to skip. |
| Your vault's repository     | Your notebook's address, or Enter to start a new notebook.                                              |
| Time zone                   | Enter keeps your computer's time zone.                                                                  |
| Default engine              | Enter keeps Claude Code.                                                                                |
| Trusted GitHub accounts     | Your GitHub user name. Eva then opens your own projects without a question.                             |
| Claude token                | The token from `claude setup-token`.                                                                    |
| Telegram bot token          | The token from BotFather.                                                                               |
| Telegram chat id            | Enter, to pair with a code instead.                                                                     |
| Google account, voice model | Enter, to skip. See [the optional features](reference.md#optional-features).                            |
| Tailscale                   | Yes. Open the link that it shows, and sign in. See [Open Eva on your phone](#open-eva-on-your-phone).   |

You can run `bun run eva setup` again at any time. It keeps every answer that you do not change.

## Open Eva on your phone

The last step of setup connects Eva's computer to Tailscale:

1. Setup shows a sign-in link. Open it on any device, and sign in with your Tailscale account.
2. A new Tailscale network must turn HTTPS on once. Setup shows the page; press **Enable** there.
3. Setup prints Eva's address, such as `https://your-computer.your-tailnet.ts.net`.

Then, on your phone:

1. Install the **Tailscale** app, sign in with the same account, and switch it on.
2. Open the address. Send `/link` to your bot in Telegram if you forget it. The first time, the page shows a short code and Eva asks in Telegram whether to allow this device: tap **Allow** when the code matches.
3. Choose "Add to Home screen" in the browser menu. Eva then opens like an app.

Do the same on any other computer: install Tailscale, sign in, open the address.

## Install Eva on a Linux server

These steps install Eva for one user with no `sudo` (administrator rights), for example over SSH. They need `git`, `curl` and `python3`.

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

3. Set Eva up in one command. An SSH address (`git@github.com:you/vault.git`) uses the machine's SSH key; an HTTPS address uses `EVA_GITHUB_TOKEN`.

   ```bash
   EVA_TIME_ZONE="Europe/Madrid" \
   EVA_VAULT_REPOSITORY="git@github.com:you/vault.git" \
   EVA_GITHUB_TOKEN="..." \
   EVA_CLAUDE_TOKEN="..." \
   EVA_TELEGRAM_BOT_TOKEN="..." \
   EVA_TELEGRAM_CHAT_ID="..." \
   bun run src/main.ts setup --non-interactive
   ```

   `src/frontends/cli/setup.ts` lists every `EVA_*` name.

4. Start Eva with the system. The command also runs `loginctl enable-linger`, so that Eva keeps running after you log out. When that step fails, it prints the command for an administrator.

   ```bash
   bun run src/main.ts service install
   ```

5. Check her with `bun run src/main.ts status`. The log is in `~/.config/eva/logs/`.

A laptop server must not sleep when its lid closes. Ask the machine's administrator to set `HandleLidSwitch=ignore` in `/etc/systemd/logind.conf`.

### Tailscale without root

On a Linux server without `sudo`, Tailscale runs as a normal user in its userspace mode. Download the static build from [pkgs.tailscale.com](https://pkgs.tailscale.com/stable/#static), and put `tailscale` and `tailscaled` in `~/.local/lib/tailscale/`. Then:

1. Create `~/.local/bin/tailscale`, so that every command finds the user's own socket, and make it executable:

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

## A second person on the same computer

Each person gets their own Eva, with their own notebook, bot and Claude login. Give the second Eva her own home folder:

```bash
bun run eva --home ~/eva-partner setup
```

```bash
bun run eva --home ~/eva-partner service install
```

Setup picks a free port for her. Her Claude and GitHub logins stay in her home folder, so two people never share a login.
