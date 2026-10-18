# Install Eva, step by step

This guide installs Eva on the computer that stays on (the hub). It takes about 30 minutes. You type a few commands in a terminal: on Windows, open **PowerShell** from the Start menu; on Linux, open **Terminal**.

When a step says "run", type the command and press Enter.

## Before you start

Create these accounts first, in your browser:

1. **Claude** at [claude.ai](https://claude.ai), with a Pro or Max subscription.
2. **GitHub** at [github.com](https://github.com).
3. **Tailscale** at [tailscale.com](https://tailscale.com) (free). Sign in with Google, Microsoft or GitHub.
4. **Telegram** on your phone, from your app store.

## Prepare a server that you reach from your desk

Skip this section when Eva runs on a computer that you use every day. Read it when Eva gets her own machine, such as an old laptop in a cupboard. You set the machine up once, and from then on you reach it only over SSH (a secure terminal connection from another computer). A coding agent that helps you can follow these steps too.

1. **Install Ubuntu Server LTS.** Choose the Server edition: with no desktop, an old laptop keeps its memory for Eva. Download it from [ubuntu.com/download/server](https://ubuntu.com/download/server).
2. **Write the installer to a USB stick with [Rufus](https://rufus.ie).** Choose "ISO Image mode", partition scheme `GPT`, target `UEFI (non CSM)`, file system `FAT32`. Do not use balenaEtcher: old firmware does not see the stick that it makes.
3. **Install with these answers:**
   - **Disk:** use the entire disk, and clear "Set up this disk as an LVM group". Otherwise Ubuntu uses only about 100 GB of the disk.
   - **Password:** use only letters and digits. The keyboard layout can change between the installer and the login, and symbols move.
   - **Install OpenSSH server:** yes. This is how you reach the machine later.
   - **Third-party drivers:** none.
4. **Check the bootloader before you press "Reboot Now".** Some laptops finish the install with no bootloader, and then show "no bootable device". Open **Help → Enter shell**, and run `ls /target/boot/efi/EFI/BOOT`. If `BOOTX64.EFI` is not there, run `chroot /target grub-install --removable` after you bind-mount `/dev`, `/dev/pts`, `/proc`, `/sys` and `/run` into `/target`.
5. **Connect from your desk.** On the server, run `ip address`, and note the address that starts with `192.168.` or `10.`. On your computer, run `ssh your-user@<address>`.
6. **Log in with a key, not a password.** On your computer, run `ssh-keygen -t ed25519 -f ~/.ssh/eva_server`. Then copy the public half to the server with `ssh-copy-id -i ~/.ssh/eva_server.pub your-user@<address>`. Windows has no `ssh-copy-id`: append the `.pub` file to `~/.ssh/authorized_keys` on the server instead. To give a coding agent access, append its public key the same way. Delete the line to remove the access.
7. **Keep the address fixed.** In your router, add a DHCP reservation (a fixed address for this machine) inside the router's DHCP range. Some routers accept an address outside the range and then ignore it.
8. **Keep the server awake** (needs `sudo`):
   - **Closed lid:** run `sudo mkdir -p /etc/systemd/logind.conf.d`, then write `[Login]` and `HandleLidSwitch=ignore` in `/etc/systemd/logind.conf.d/eva.conf`.
   - **Wi-fi:** use a cable when you can. On wi-fi, some cards save power by sleeping between packets, and every talk with GitHub then stalls. Run `iw dev` to find the card name, then `sudo iw dev <card> set power_save off`. Repeat it at each start with a systemd unit.
   - **Power:** keep the laptop plugged in.

Then follow [Install Eva on a Linux server](#install-eva-on-a-linux-server), over SSH.

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

- **Start a new notebook.** Leave the repository question empty during setup. Eva creates the notebook from her template, and can create its private GitHub repository for you. To let Eva clone your private projects, type `login` at the GitHub question.
- **Use a notebook that you already have.** Give its address during setup, such as `https://github.com/you/vault`. Then log in to GitHub in the browser:
  1. Press Enter when setup asks for the GitHub login.
  2. Open the link that setup shows, on any device, and enter the short code.
  3. Confirm the login on GitHub. Setup goes on by itself.

  The login lets Eva read and write all your GitHub repositories, private ones too. Eva uses it only to reach GitHub for you, and never gives it to the AI tools that she runs. You can remove it on GitHub under **Settings → Applications**.

  An address that starts with `git@` uses the computer's SSH key. It needs a login only for private projects: type `login` at the GitHub question.

  The browser login is not ready yet ([#113](https://github.com/guplem/eva/issues/113)). Until then, setup asks for a GitHub token. Create the token yourself, and paste it. Do the same if you want Eva to reach only your notebook:
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

   If Eva crashes, she starts again within a minute. On the hub, she then tells you in Telegram. She does not start again after you stop her, or when her settings are wrong.
   On Windows, if you installed the service before this behavior existed, run the command again once. The change takes effect at your next logon.

5. Pair your Telegram chat, so that Eva answers only you. Run `bun run eva status`: it shows a line such as `Telegram pairing code: send EVA-1A2B3C4D to your bot`. Send that code to your bot in Telegram. From then on, Eva answers only that chat.

## What setup asks

Press Enter to keep the value in brackets. Eva saves each answer on this computer.

| Question                    | What to answer                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Time zone                   | Enter keeps your computer's time zone.                                                                                                                                                                                                                                   |
| Your vault's repository     | Your notebook's address, or Enter to start a new notebook.                                                                                                                                                                                                               |
| GitHub login or token       | For an `https://github.com/` address, Enter logs in in the browser. Otherwise, type `login`, or press Enter to skip. Until [#113](https://github.com/guplem/eva/issues/113), paste the token. See [Decide where your notebook lives](#decide-where-your-notebook-lives). |
| New notebook                | For a new notebook only: `y`, then the questions below.                                                                                                                                                                                                                  |
| What should Eva call you?   | Your name, or the name that you like.                                                                                                                                                                                                                                    |
| Language                    | The language of Eva's answers. Enter keeps English.                                                                                                                                                                                                                      |
| Main topics                 | A few words, such as `work, family, music`. Change them later in `.eva/assistant.md`.                                                                                                                                                                                    |
| New GitHub repository       | A name for your notebook's private repository, such as `vault`.                                                                                                                                                                                                          |
| Default engine              | Enter keeps Claude Code.                                                                                                                                                                                                                                                 |
| Trusted GitHub accounts     | Your GitHub user name. Eva then opens your own projects without a question.                                                                                                                                                                                              |
| Claude token                | The token from `claude setup-token`.                                                                                                                                                                                                                                     |
| Telegram bot token          | The token from BotFather.                                                                                                                                                                                                                                                |
| Telegram chat id            | Enter, to pair with a code instead.                                                                                                                                                                                                                                      |
| Google account, voice model | Enter, to skip. See [the optional features](reference.md#optional-features).                                                                                                                                                                                             |
| Tailscale                   | Yes. Open the link that it shows, and sign in. See [Open Eva on your phone](#open-eva-on-your-phone).                                                                                                                                                                    |

You can run `bun run eva setup` again at any time. It keeps every answer that you do not change.

## Open Eva on your phone

The last step of setup connects Eva's computer to Tailscale:

1. Without Tailscale, setup offers to install it. On Windows, Eva uses `winget`, the Windows package tool. Accept the prompt that asks for administrator rights. Linux gets the userspace build, with no `sudo` (see [Tailscale without root](#tailscale-without-root)). On other systems, install Tailscale from [tailscale.com/download](https://tailscale.com/download).
2. Setup shows a sign-in link. Open it on any device, and sign in with your Tailscale account.
3. A new Tailscale network must turn HTTPS on once. Setup shows the page; press **Enable** there.
4. Setup prints Eva's address, such as `https://your-computer.your-tailnet.ts.net`, and a QR code.

You can also do these steps later, from your phone: send `/link` to your bot in Telegram, and tap the buttons. The **Use Eva from any device** section in Settings shows the same steps. Eva finds each change by herself within a minute, with no restart.

Then, on your phone:

1. Install the **Tailscale** app, sign in with the same account, and switch it on.
2. Open the address, or scan the QR code from Settings on another screen. Send `/link` to your bot in Telegram if you forget the address. The first time, the page shows a short code and Eva asks in Telegram whether to allow this device: tap **Allow** when the code matches.
3. Choose "Add to Home screen" in the browser menu. Eva then opens like an app.

Do the same on any other computer: install Tailscale, sign in, open the address. Settings has a **Copy** button for the address, and a **Share** button on a phone.

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

On a Linux server without `sudo`, Tailscale runs as a normal user in its userspace mode. Eva does these steps for you: in `eva setup`, with `/link` in Telegram, or in Settings. Eva installs only when no `tailscale` program exists, so she never starts a second Tailscale beside the system one. Linger is a systemd setting that keeps your services running after you log out. Tailscale needs it, as Eva does. Run `eva doctor` to check it.

If Tailscale already runs for the administrator, Eva cannot sign in or publish her page with it. Ask the administrator to run `sudo tailscale set --operator=$USER` once.

To do the steps by hand, download the static build from [pkgs.tailscale.com](https://pkgs.tailscale.com/stable/#static), and put `tailscale` and `tailscaled` in `~/.local/lib/tailscale/`. Then:

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

Setup picks a free port for her. Her pi and GitHub logins stay in the `engines` folder of her home, so two people never share a login or a subscription. Her Claude token stays in her `secrets.json`.

| Engine      | Folder             | Variable              | What it holds                 |
| ----------- | ------------------ | --------------------- | ----------------------------- |
| Claude Code | `engines/claude`   | `CLAUDE_CONFIG_DIR`   | Claude's settings and history |
| pi          | `engines/pi-agent` | `PI_CODING_AGENT_DIR` | pi's login and settings       |
| GitHub CLI  | `engines/gh`       | `GH_CONFIG_DIR`       | gh's login                    |
| git         | `engines/git`      | `GIT_CONFIG_GLOBAL`   | git's GitHub login setting    |

Setup gives one login step for each login that is missing, with her folder in the command. Run each step in another terminal while setup goes on. On Windows, use PowerShell. At the end, setup shows which logins are in place. Run `bun run eva --home ~/eva-partner setup` again to check them later.

The GitHub step uses `gh auth login --insecure-storage`. gh otherwise keeps its token in the system keyring under one name for all folders, and her login would replace yours. With the flag, gh keeps her token as plain text in her own folder. When gh asks to authenticate git, answer No: that changes the git settings that both Evas share.

Her agent's own `git push` to GitHub uses her gh login. Eva writes `engines/git/gitconfig` at each start. That file includes your computer user's global git settings, such as your aliases. Then it tells git to ask her gh for GitHub logins. Her commits still carry the name and email of your global settings, unless the clone sets its own with `git config user.name` and `git config user.email`. For other hosts, git still uses the login of your computer user, such as Git Credential Manager. To keep those apart too, give her a separate computer user.

The first Eva on a computer uses the computer user's own logins, the same as when the person runs Claude Code, pi or `gh` by hand.
