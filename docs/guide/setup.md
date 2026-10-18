# Install Eva, step by step

This guide installs Eva on the computer that stays on (the hub). It takes about 30 minutes. You type a few commands in a terminal: on Windows, open **PowerShell** from the Start menu; on Linux, open **Terminal**.

When a step says "run", type the command and press Enter.

## Before you start

Create these accounts first, in your browser:

1. **An AI subscription.** A Claude Pro or Max subscription at [claude.ai](https://claude.ai), or a login of another provider that pi supports, such as ChatGPT or GitHub Copilot.
2. **GitHub** at [github.com](https://github.com). Your notebook lives there.
3. **Telegram** on your phone, from your app store. It is optional, but it is the easiest way to talk to Eva and to get her alerts.
4. **Tailscale** at [tailscale.com](https://tailscale.com) (free). It is optional: you need it only to open Eva's web page from another device. Sign in with Google, Microsoft or GitHub.

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

Then follow [Install Eva on Linux](#install-eva-on-linux), over SSH.

## Create your Telegram bot

A bot is a Telegram account that a program controls. Eva talks to you through your own bot.

1. In Telegram, open a chat with **@BotFather** (the official bot that makes bots).
2. Send `/newbot`.
3. Give it a name, for example `My Eva`, and a user name that ends in `bot`, for example `my_eva_123_bot`.
4. BotFather answers with a **token**: a long code such as `123456789:AAH...`. Copy it. Eva asks for it during setup. Never share it: whoever has it controls the bot.

## Connect your AI

Eva does not think by herself. She runs a harness: a program that runs an AI agent with your login. Eva knows two harnesses, Claude Code and pi. `eva setup` installs both when they are missing, so you install nothing yourself. You give the login of the harness that you use.

**Claude Code**, for a Claude subscription:

1. Run `claude setup-token` on any computer with a browser, such as your laptop. Sign in when the browser opens.
   On Eva's computer, if the terminal does not find `claude`, run the command that setup showed after the install.
2. Copy the token that it prints. It lasts a year.
3. Paste it into setup at "Claude token", or into **Engines** in Settings on Eva's page.

**pi**, for another provider, such as ChatGPT, GitHub Copilot or an API key:

1. After setup installs pi, open another terminal.
2. Run `pi`. On Windows, a terminal does not find `pi`: run the command that setup showed after the install instead. Type `/login`, and choose your provider. Never choose Anthropic: a Claude login in pi bills as extra usage.
3. In setup, press Enter at "Claude token". If you log in to pi after setup ends, run `eva setup` again, or choose pi in Settings in the web app.

Claude Code is the default engine at first: the harness that a new chat uses. Setup changes the default only when it has no login and the other harness has one. To change the default engine, open Settings in the web app. You can also choose the harness for each chat.

When an install fails, setup says why, and gives the command to install the harness by hand. `eva doctor` shows a missing harness too.

## Decide where your notebook lives

Your notebook (the vault) is a private GitHub repository of notes. Choose one:

- **Use a notebook that you already have.** At the repository question, give its address, such as `https://github.com/you/vault`. Eva clones it (makes a copy on this computer).
- **Start a new notebook.** Press Enter at the repository question. Then type a folder for the notebook, and answer `y` to "Create a new vault there?". Eva fills the folder from her template. To also get a private GitHub repository for it, install the [GitHub CLI](https://cli.github.com) (`gh`) and run `gh auth login` before setup.

Setup also asks for a GitHub token (a password for one app). Eva needs it for a private notebook with an `https://` address, and to clone your private projects. An address that starts with `git@` uses the computer's SSH key instead. Eva keeps the token on this computer, and never gives it to the AI tools that she runs. To create the token:

1. Open GitHub, then **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Under **Repository access**, pick your notebook. To let Eva clone your private projects too, choose **All repositories**.
3. Under **Permissions → Contents**, choose **Read and write**.
4. Generate the token and copy it.

## Install Eva on Windows

1. Install git. Run:

   ```bash
   winget install --id Git.Git -e
   ```

2. Download Eva into her own folder, and add that folder to your `PATH` (the list of folders where Windows finds programs). Run these one by one:

   ```bash
   New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\Programs\Eva"
   ```

   ```bash
   Invoke-WebRequest https://github.com/guplem/eva/releases/latest/download/eva-windows-x64.exe -OutFile "$env:LOCALAPPDATA\Programs\Eva\eva.exe"
   ```

   ```bash
   [Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:LOCALAPPDATA\Programs\Eva", "User")
   ```

   Close PowerShell and open it again, so that it finds the new programs.

3. Run the setup, as [The short path](#the-short-path) says:

   ```bash
   eva setup
   ```

   When setup starts Eva, Windows may ask for permission. If it refuses, open PowerShell with **Run as administrator**, and run `eva service install`.

   If Eva crashes, she starts again within a minute. On the hub, she then tells you in Telegram. She does not start again after you stop her, or when her settings are wrong.

4. With a Telegram bot, pair your chat, so that Eva answers only you. Run `eva status`: it shows a line such as `Telegram pairing code: send EVA-1A2B3C4D to your bot`. Send that code to your bot in Telegram. From then on, Eva answers only that chat.

## The short path

Eva's computer may have no screen. You then reach it over SSH, and touch it as little as possible. `eva setup` does the steps that only that computer can do, and you finish the rest on Eva's page:

1. Setup installs what is missing: Claude Code, pi and Tailscale. Open the Tailscale sign-in link that it shows, on any device.
2. Setup asks to start Eva. Press Enter. She then starts by herself each time the computer starts.
3. Setup shows Eva's address. Open it on your phone or your laptop. The page shows a short code.
4. Type that code in the terminal. The device that shows it can now open Eva, with the same control as the terminal.
5. Finish on the page: **Settings** lists each step that is left, with what to do. Or answer the next questions in the terminal. Both work at the same time. Your notebook needs the terminal: the page cannot clone it yet.

Setup saves each answer at once, so you can stop it with Ctrl+C at any question and lose nothing. A step done on the page is not asked again in the terminal. To let another device in later, open the page on it, and run `eva devices allow <code>` on Eva's computer.

## What setup asks

Setup asks each question only when its step is not done yet. Press Enter to keep the value in brackets, or to skip a question.

| Question                     | What to answer                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code and pi           | No question. Setup installs each harness that is missing. See [Connect your AI](#connect-your-ai).                                                |
| Tailscale                    | Enter installs it, then Enter signs in. Open the link that it shows. See [Open Eva on your phone](#open-eva-on-your-phone).                       |
| Start Eva                    | Enter starts Eva now, and each time the computer starts.                                                                                          |
| The code that the page shows | The short code on Eva's page, to let that device in. Enter goes on in the terminal.                                                               |
| Time zone                    | Enter keeps your computer's time zone.                                                                                                            |
| Your vault's repository      | Your notebook's address, or Enter to start a new notebook.                                                                                        |
| GitHub token                 | A token for a private notebook and private projects, or Enter to skip. See [Decide where your notebook lives](#decide-where-your-notebook-lives). |
| Vault folder                 | For a new notebook only: the folder for it. Enter keeps the folder in brackets.                                                                   |
| New notebook                 | For a new notebook only: `y`, then the questions below.                                                                                           |
| What should Eva call you?    | Your name, or the name that you like.                                                                                                             |
| Language                     | The language of Eva's answers. Enter keeps English.                                                                                               |
| Main topics                  | A few words, such as `work, family, music`. Change them later in `.eva/assistant.md`.                                                             |
| New GitHub repository        | A name for your notebook's private repository, such as `vault`. This needs `gh`.                                                                  |
| Trusted GitHub accounts      | Your GitHub user name. Eva then opens your own projects without a question.                                                                       |
| Claude token                 | The token from `claude setup-token`. With pi, press Enter.                                                                                        |
| Telegram bot token           | Optional: the token from BotFather. Eva works without Telegram.                                                                                   |
| Telegram chat id             | Enter, to pair with a code instead.                                                                                                               |
| Google account               | Enter, to skip. See [the optional features](reference.md#optional-features).                                                                      |
| Google client id, secret     | For a Google account only: from your own Google OAuth client.                                                                                     |
| Voice model                  | Enter, to skip. See [the optional features](reference.md#optional-features).                                                                      |

You can run `eva setup` again at any time. It asks only for the steps that are not done.

## Install Eva on Linux

These steps work over SSH too. They install Eva for your own user.

1. Install git, if `git --version` does not find it. On Ubuntu or Debian, run:

   ```bash
   sudo apt install -y git
   ```

2. Download Eva into `~/.local/bin`, a folder for your own programs. On an ARM computer, such as a Raspberry Pi, use `eva-linux-arm64` instead of `eva-linux-x64`.

   ```bash
   mkdir -p ~/.local/bin
   curl -fsSL -o ~/.local/bin/eva https://github.com/guplem/eva/releases/latest/download/eva-linux-x64
   chmod +x ~/.local/bin/eva
   export PATH="$HOME/.local/bin:$PATH"
   ```

   The last line lets this terminal find `eva`. Ubuntu adds the folder to the `PATH` by itself at your next login.

3. Run the setup, as [The short path](#the-short-path) says:

   ```bash
   eva setup
   ```

   When setup starts Eva, it also runs `loginctl enable-linger`, so that Eva keeps running after you log out. When that step fails, it prints the command for an administrator. If you said no, run `eva service install` later.

4. With a Telegram bot, pair your chat: run `eva status`, and send the code that it shows to your bot. The log is in `~/.config/eva/logs/`.

**Set Eva up with no questions.** For a script, give each answer in an `EVA_*` variable, and add `--non-interactive`. `src/frontends/cli/setup.ts` lists every name. Setup installs Claude Code and pi here too. A failed install does not stop the script: setup prints the command to install by hand. With pi, leave out `EVA_CLAUDE_TOKEN`. To set the default engine, add `EVA_ENGINE="pi"` or `EVA_ENGINE="claude-code"`. To install no harness, add `EVA_INSTALL_ENGINES="no"`. A script starts Eva only with `EVA_START_SERVICE="yes"`, and it never waits for a device code.

```bash
EVA_TIME_ZONE="Europe/Madrid" EVA_VAULT_REPOSITORY="https://github.com/you/vault" EVA_GITHUB_TOKEN="..." EVA_CLAUDE_TOKEN="..." EVA_TELEGRAM_BOT_TOKEN="..." eva setup --non-interactive
```

### Tailscale without root

On a Linux server without `sudo`, Tailscale runs as a normal user in its userspace mode. Eva installs it this way for you: in `eva setup`, with `/link` in Telegram, or in Settings. Eva installs only when no `tailscale` program exists, so she never starts a second Tailscale beside the system one. Linger is a systemd setting that keeps your services running after you log out. Tailscale needs it, as Eva does. Run `eva doctor` to check it.

If Tailscale already runs for the administrator, Eva cannot sign in or publish her page with it. Ask the administrator to run `sudo tailscale set --operator=$USER` once.

## Open Eva on your phone

The last step of setup connects Eva's computer to Tailscale:

1. Without Tailscale, setup offers to install it. On Windows, Eva uses `winget`, the Windows package tool. Accept the prompt that asks for administrator rights. Linux gets the userspace build, with no `sudo` (see [Tailscale without root](#tailscale-without-root)). If setup cannot install it, install Tailscale from [tailscale.com/download](https://tailscale.com/download).
2. Setup shows a sign-in link. Open it on any device, and sign in with your Tailscale account.
3. A new Tailscale network must turn on HTTPS once. Setup shows the page. Turn on **HTTPS Certificates** there.
4. Setup prints Eva's address, such as `https://your-computer.your-tailnet.ts.net`, and a QR code.

You can also do these steps later, from your phone: send `/link` to your bot in Telegram, and tap the buttons. The **Use Eva from any device** section in Settings shows the same steps. Eva finds each change by herself within a minute, with no restart.

Then, on your phone:

1. Install the **Tailscale** app, sign in with the same account, and switch it on.
2. Open the address, or scan the QR code from Settings on another screen. Send `/link` to your bot in Telegram if you forget the address. The first time, the page shows a short code and Eva asks in Telegram whether to allow this device. Tap **Allow** when the code matches.
3. Choose "Add to Home screen" in the browser menu. Eva then opens like an app.

Do the same on any other computer: install Tailscale, sign in, open the address. Settings has a **Copy** button for the address, and a **Share** button on a phone.

## Add the optional tools

Some features need one more program on Eva's computer. For example, the Google tools need [uv](https://docs.astral.sh/uv/), and voice notes need ffmpeg and whisper.cpp. Run:

```bash
eva doctor
```

It lists each missing tool, the feature that needs it, and how to install it. [The optional features](reference.md#optional-features) tells how to turn on each feature. For Google, you can do most of [Set up Google](reference.md#set-up-google) before you install Eva.

## A second person on the same computer

Each person gets their own Eva, with their own notebook, bot and AI login. Give the second Eva her own home folder:

```bash
eva --home ~/eva-partner setup
```

```bash
eva --home ~/eva-partner service install
```

Setup picks a free port for her. Her Claude Code, pi and GitHub logins stay in the `engines` folder of her home, so two people never share a login or a subscription. Setup prints one command for each login that is missing. Run each command in another terminal while setup goes on. Run `eva --home ~/eva-partner setup` again to check the logins later.

Her commits carry the name and email of your global git settings, unless her clone sets its own with `git config user.name` and `git config user.email`. For hosts other than GitHub, git uses your own login. To keep everything apart, give her a separate computer user.
