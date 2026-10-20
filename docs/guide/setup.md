# Install Eva, step by step

This guide installs Eva on the computer that stays on. It takes about 30 minutes. You type a few commands in a terminal: on Windows, open **PowerShell** from the Start menu; on Linux, open **Terminal**, or connect over SSH.

When a step says "run", type the command and press Enter.

## Before you start

Create these accounts first, in your browser:

1. **An AI subscription.** A Claude Pro or Max subscription at [claude.ai](https://claude.ai), or a login of another provider that pi supports, such as ChatGPT or GitHub Copilot.
2. **GitHub** at [github.com](https://github.com). Your notebook lives there.
3. **Telegram** on your phone. It is optional, but it is the easiest way to talk to Eva and to get her alerts.
4. **Tailscale** at [tailscale.com](https://tailscale.com) (free). It is optional: you need it only to open Eva's page from your phone or another computer.

Will Eva get her own computer, with no screen, such as an old laptop in a cupboard? Prepare it first: see [Prepare a server that you reach from your desk](#prepare-a-server-that-you-reach-from-your-desk).

## 1. Run the install command

On Linux:

```bash
curl -fsSL https://github.com/guplem/eva/releases/latest/download/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://github.com/guplem/eva/releases/latest/download/install.ps1 | iex
```

The command does these steps:

- It installs git when git is missing, and on Linux curl too. On Linux, this needs administrator rights, so `sudo` asks for your password. On Windows, it uses winget, the program installer of Windows.
- It downloads Eva from the latest release, and checks the download, so a broken download stops.
- It puts Eva where your terminal finds her: `~/.local/bin` on Linux, `%LOCALAPPDATA%\Programs\Eva` on Windows.
- It starts `eva setup`, the next step.

Eva runs on Linux and Windows, not on macOS. If your Linux user has no `sudo`, or your Windows has no winget, install git yourself first, then run the command again.

## 2. Answer the setup

Setup asks only what it needs, in this order. Press Enter to keep the value in brackets, or to skip a question.

1. **A name for this Eva.** Enter keeps `eva`. A second Eva on the same computer needs another name: see [More than one Eva on a computer](#more-than-one-eva-on-a-computer).
2. **The programs.** Setup checks the tools, and installs what is missing with no question: Claude Code and pi (the harnesses), and uv (for the Google tools).
3. **Tailscale.** Press Enter to install it, and Enter again to sign in. Open the link that setup shows, on any device, and sign in with your Tailscale account. A new Tailscale account must turn on **HTTPS Certificates** once: setup shows the page.
4. **Start Eva.** Press Enter. Eva starts now, and each time the computer starts.
5. **Let your phone in.** Setup shows Eva's address and a QR code. Install the Tailscale app on your phone, sign in with the same account, and open the address. The page shows a short code. Type it in the terminal.

Then finish where it suits you. Each answer is saved at once, in both places:

- **On the page:** **Settings** lists each step that is left, with what to do: your AI login, your notebook, GitHub, Telegram and Google.
- **In the terminal:** setup goes on with the same steps. It asks for your time zone, the GitHub login and your notebook, a few words about you for a new notebook, the GitHub accounts that you trust (your own user name, so that Eva opens your projects without a question), the Claude token, the Telegram bot, Google and voice notes.

You can stop setup with Ctrl+C at any question and lose nothing. Run `eva setup` again at any time: it asks only for the steps that are not done.

The next sections explain each step in more detail.

## Log in to your AI

Eva does not think by herself. She runs a harness: a program that runs an AI agent with your login. Eva knows two harnesses, Claude Code and pi. Setup installs both. You give the login of the one that you use. Each Eva keeps her logins in her own folder, apart from your own Claude Code and pi.

**Claude Code**, for a Claude subscription. Log in from Eva's page, also on a phone:

1. Open **AI engines** in Settings, and press **Log in to Claude**.
2. Press **Open Claude's page**, log in with your Claude account, and allow the access.
3. Claude's page shows a code. Paste it into Eva's page, and press **Finish**. Then press **Restart Eva**.

Or, in a terminal: run `claude setup-token` on any computer with a browser, such as your laptop. Paste the token that it prints into setup at "Claude token", or into **AI engines** in Settings. The token lasts a year.

**pi**, for another provider, such as ChatGPT, GitHub Copilot or an API key:

1. Run the pi command that setup showed after the install. It points pi at this Eva's own folder.
2. Type `/login`, and choose your provider. Never choose Anthropic: a Claude login in pi bills as extra usage.
3. In setup, press Enter at "Claude token". If you log in to pi after setup ends, choose pi in Settings, or run `eva setup` again.

A new chat uses Claude Code, unless only pi has a login. Change the engine for new chats in Settings. You can also choose the engine of each chat.

## Pick your notebook

Your notebook (the vault) is a private GitHub repository of notes.

In the terminal, setup first logs in to GitHub:

1. Press Enter at the GitHub question. Setup shows a short code.
2. Open [github.com/login/device](https://github.com/login/device) on any device, and enter the code. Press **Authorize**.
3. Setup lists your 15 most recent repositories. Then:
   - **To use a notebook that you have,** type its number or its name, such as `vault`. Eva clones it (makes a copy on this computer).
   - **To start a new notebook,** type `0`, and answer the questions about you. Then type a name for its private repository, such as `vault`. Eva creates it from her template.
   - **For no notebook now,** press Enter.

On the page, paste a GitHub token in **Connect GitHub**, then pick or create the notebook in **Set up your vault**.

The GitHub login lets Eva read and write all your repositories, private ones too, so that she can also clone your projects. Eva keeps it on this computer, and never gives it to her AI agents. You can remove it on GitHub under **Settings → Applications**.

To give Eva only your notebook, paste a token at the GitHub question instead. On GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. Pick your notebook under **Repository access**, choose **Read and write** under **Permissions → Contents**, and generate the token.

## Connect Telegram (optional)

A bot is a Telegram account that a program controls. Eva talks to you through your own bot.

1. In Telegram, open a chat with **@BotFather** (the official bot that makes bots), and send `/newbot`.
2. Give it a name, such as `My Eva`, and a user name that ends in `bot`, such as `my_eva_123_bot`.
3. BotFather answers with a **token**: a long code such as `123456789:AAH...`. Paste it into setup, or into **Connect Telegram** in Settings. Never share it: whoever has it controls the bot.
4. Pair your chat, so that Eva answers only you. Run `eva status`: it shows a line such as `Telegram pairing code: send EVA-1A2B3C4D to your bot`. Send that code to your bot.

## Open Eva on your phone

Each device needs the Tailscale app, signed in with the same account as Eva's computer. Then:

1. Open Eva's address. Send `/link` to your bot, or look in **Use Eva from any device** in Settings, if you forget it.
2. The first time, the page shows a short code. Allow it in one of these ways:
   - Run `eva devices allow <code>` on Eva's computer.
   - Tap **Allow** in Telegram, or on another device where Eva's page is open.
3. On a phone, choose "Add to Home screen" in the browser menu. Eva then opens like an app.

You can also set up Tailscale later, from your phone: send `/link` to your bot, or open **Set up phone access** in Settings.

## Add the optional tools

Some features need one more program on Eva's computer. For example, voice notes need ffmpeg and whisper.cpp, and PDFs need typst. Run `eva doctor`: it lists each missing tool, the feature that needs it, and how to install it. [Optional features](reference.md#optional-features) tells how to turn on each feature. For Google, you can do most of [Set up Google](reference.md#set-up-google) before you install Eva.

## More than one Eva on a computer

Each Eva has a name, such as `eva` or `ana`, and her own notebook, bot, settings, logins and port. Two people can share a computer, each with their own Eva. All Evas on a computer share the same programs: git, Claude Code, pi, uv and Tailscale.

To make another Eva, run `eva setup` (the computer has Eva already, so skip the install command). Setup lists the Evas on this computer. Type a new name, such as `ana`, and answer setup as for the first Eva.

With more than one Eva, each command asks which Eva. To skip the question, name her: `eva --instance ana status`, or set `EVA_INSTANCE=ana` in the terminal.

Each Eva lives in her own folder, `eva-<name>`, in `~/.config` on Linux or `%APPDATA%` on Windows. Her logins stay there, so two people never share a login or a subscription. Setup prints one command for each login that is missing: run it in another terminal while setup goes on.

The commits of each Eva carry the name and email of your global git settings, unless her clone sets its own with `git config user.name` and `git config user.email`. For hosts other than GitHub, git uses your own login.

**Share a computer user only with people that you trust fully.** All Evas of one computer user can read each other's files, such as notes and tokens. Eva never does this by herself, but nothing on the computer stops it. For people who need privacy from each other, give each person their own computer user, or their own computer.

## Prepare a server that you reach from your desk

Read this when Eva gets her own computer, such as an old laptop with no screen. You set it up once, and then you reach it only over SSH (a secure terminal connection from another computer). A coding agent that helps you can follow these steps too.

1. **Install Ubuntu Server LTS** from [ubuntu.com/download/server](https://ubuntu.com/download/server). The Server edition has no desktop, so an old laptop keeps its memory for Eva.
2. **Write the installer to a USB stick with [Rufus](https://rufus.ie).** Choose "ISO Image mode", partition scheme `GPT`, target `UEFI (non CSM)`, file system `FAT32`. Do not use balenaEtcher: old firmware does not see the stick that it makes.
3. **Install with these answers:**
   - **Disk:** use the entire disk, and clear "Set up this disk as an LVM group". Otherwise Ubuntu uses only about 100 GB.
   - **Password:** use only letters and digits. The keyboard layout can change between the installer and the login, and symbols move.
   - **Install OpenSSH server:** yes.
   - **Third-party drivers:** none.
4. **Check the bootloader before you press "Reboot Now".** Some laptops finish with no bootloader, and then show "no bootable device". Open **Help → Enter shell**, and run `ls /target/boot/efi/EFI/BOOT`. If `BOOTX64.EFI` is not there, bind-mount `/dev`, `/dev/pts`, `/proc`, `/sys` and `/run` into `/target`, then run `chroot /target grub-install --removable`.
5. **Connect from your desk.** On the server, run `ip address`, and note the address that starts with `192.168.` or `10.`. On your computer, run `ssh your-user@<address>`.
6. **Log in with a key.** On your computer, run `ssh-keygen -t ed25519 -f ~/.ssh/eva_server`, then `ssh-copy-id -i ~/.ssh/eva_server.pub your-user@<address>`. Windows has no `ssh-copy-id`: append the `.pub` file to `~/.ssh/authorized_keys` on the server instead. Give a coding agent access the same way, and delete its line to remove the access.
7. **Keep the address fixed.** In your router, add a DHCP reservation (a fixed address for this machine) inside the router's DHCP range. Some routers accept an address outside the range and then ignore it.
8. **Keep the server awake** (needs `sudo`):
   - **Closed lid:** create `/etc/systemd/logind.conf.d/eva.conf` with the lines `[Login]` and `HandleLidSwitch=ignore`.
   - **Wi-fi:** use a cable when you can. Some wi-fi cards sleep between packets, and every talk with GitHub then stalls. Run `iw dev` to find the card, then `sudo iw dev <card> set power_save off`, and repeat it at each start with a systemd unit.
   - **Power:** keep the laptop plugged in.

Then run [the install command](#1-run-the-install-command) over SSH.

## Install by hand, or from a script

**By hand.** To read each step before it runs, read [install.sh](../../install/install.sh) or [install.ps1](../../install/install.ps1). Or do its steps yourself:

1. Install git, and on Linux curl too.
2. Download `eva-linux-x64`, `eva-linux-arm64` or `eva-windows-x64.exe` from the [latest release](https://github.com/guplem/eva/releases/latest). Save it as `~/.local/bin/eva` and run `chmod +x ~/.local/bin/eva` on Linux, or as `%LOCALAPPDATA%\Programs\Eva\eva.exe` on Windows.
3. Add that folder to your `PATH`. On Linux, run `export PATH="$HOME/.local/bin:$PATH"`. On Windows, add it in the user environment variables, and open PowerShell again.
4. Run `eva setup` in that terminal. The service keeps the `PATH` of setup, and finds uv and the harnesses through it.

**From a script.** Give each answer in an `EVA_*` variable, and add `--non-interactive`. `src/frontends/cli/setup.ts` lists every name. Setup still installs Claude Code, pi and uv; add `EVA_INSTALL_ENGINES="no"` to skip them. With pi, leave out `EVA_CLAUDE_TOKEN`, and add `EVA_ENGINE="pi"`. A script starts Eva only with `EVA_START_SERVICE="yes"`, and never waits for a device code.

```bash
EVA_TIME_ZONE="Europe/Madrid" EVA_VAULT_REPOSITORY="https://github.com/you/vault" EVA_GITHUB_TOKEN="..." EVA_CLAUDE_TOKEN="..." EVA_TELEGRAM_BOT_TOKEN="..." eva setup --non-interactive
```

**Updates.** Eva updates herself from new releases. To update her now, run `eva update`. To repair an install, run the install command again.

**Service.** On Linux, setup runs `loginctl enable-linger`, so that Eva keeps running after you log out. When that fails, it prints the command for an administrator. On Windows, if setup cannot start the service, open PowerShell with **Run as administrator**, and run `eva service install`. If Eva crashes, she starts again within a minute.

**Tailscale without `sudo`.** On Linux, Eva installs Tailscale for your user only, with no `sudo`, when no `tailscale` program exists. It needs linger too: `eva doctor` checks it. If Tailscale already runs for the administrator, ask them to run `sudo tailscale set --operator=$USER` once, so that Eva can use it.
