# Install Eva, step by step

This guide installs Eva on the computer that stays on. It takes about 30 minutes. You type a few commands in a terminal: on Windows, open **PowerShell** from the Start menu; on Linux, open **Terminal**, or connect over SSH (a secure terminal connection from another computer).

When a step says "run", type the command and press Enter.

## Before you start

Create these accounts first, in your browser:

1. **An AI subscription.** A Claude Pro or Max subscription at [claude.ai](https://claude.ai), or a login of another provider that pi supports, such as ChatGPT or GitHub Copilot.
2. **GitHub** at [github.com](https://github.com). Your vault, the private folder of your notes, lives there.
3. **Telegram** on your phone. It is optional, but it is the easiest way to talk to Eva and to get her alerts. Without it, Eva's page can send you notifications: see [Notifications on a device](reference.md#notifications-on-a-device).
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

Setup first asks for a name for this Eva. Enter keeps the name of your computer user, such as `ana`. Then it goes through 8 numbered steps, and says which ones are done.

In the terminal, a line that starts with `>` is a question: type the answer, or press Enter to keep the value in `[brackets]` or to skip it. `[ok]` marks what is done. `>> Your turn:` means that setup waits for you to do something in a browser. When you are done, setup continues.

1. **Programs.** Setup installs what is missing: Claude Code and pi (the harnesses), uv (for the Google tools), and gh (for your agents' pushes and pull requests). It also replaces a gh older than 2.40.
2. **Phone access.** Press Enter to install Tailscale, and Enter again to sign in. Open the link that setup shows, on any device, and sign in with your Tailscale account. A new Tailscale account must turn on **HTTPS Certificates** once: setup shows the page.
3. **Start Eva.** Press Enter. Eva starts now, and again each time you log in. On Windows, this needs no administrator, and no window stays open.
4. **Your devices.** Press Enter to open Eva in this computer's browser, already logged in. Then open Eva's address on your phone and your other computers. Each page shows a short code: type it in the terminal. Press Enter when you allowed every device. Then setup asks where to continue:
   - Type `1`, or press Enter, to answer steps 5 to 8 in the terminal.
   - Type `2` to finish on Eva's web page. Setup opens the Setup page in this computer's browser, and shows the steps to follow there. Then you can close the terminal.
5. **Vault and GitHub.** Your time zone, the GitHub login, your vault, and other GitHub accounts that you trust, such as an organization. Eva trusts the account of her GitHub login already.
6. **AI login.** The Claude token, or the pi login.
7. **Telegram** (optional). Your bot.
8. **Google and voice notes** (optional).

On the page, **Settings > Setup** lists each step that is left. Each answer is saved at once, in both places. You can stop setup with Ctrl+C at any question and lose nothing. Run `eva setup` again at any time: it asks only for the steps that are not done.

The next sections explain each step in more detail.

### Open Eva on her own computer

To open Eva on her own computer later, run `eva open`. It opens her page in this computer's browser, already logged in. You need no code and no token.

On Windows, a few seconds after you log in, Eva also has an icon in the system tray, the area next to the clock. Windows can hide it under the arrow there: drag it onto the taskbar, so that it always shows. The icon shows her face for her state: she runs, she works, she needs you, or she stopped. Point at the icon to read her state. Right-click it for the menu:

- **Open Eva** opens her page in this computer's browser, already logged in. A double-click does the same.
- **Restart Eva** stops her and starts her again.
- **Quit Eva** stops her until you log in again.

If Eva stops by herself, for example because of a bad setting, the icon stays with a sleeping or crossed-out face. Fix the setting, then choose **Restart Eva**.

With more than one Eva on the computer, each Eva has her own icon. Her name is in its tooltip and at the top of its menu.

## Log in to your AI

Eva does not think by herself. She runs a harness: a program that runs an AI agent with your login. Eva knows two harnesses, Claude Code and pi. Setup installs both. You give the login of the one that you use. Each Eva keeps her logins in her own folder, apart from your own Claude Code and pi.

**Claude Code**, for a Claude subscription. Log in from Eva's page, also on a phone:

1. Open **AI engines** in Settings, and press **Start the login** under Claude Code. Eva makes a login link.
2. Press **Open Claude's page**, log in with your Claude account, and allow the access.
3. Claude's page shows a code. Paste it into Eva's page, and press **Finish**. Then press **Restart Eva**.

Or, in a terminal: run `claude setup-token` on any computer with a browser, such as your laptop. Paste the token that it prints into setup at "Claude token", or into **AI engines** in Settings. The token lasts a year.

**pi**, for the subscription of another provider, such as ChatGPT or GitHub Copilot:

1. Run the pi command that setup showed after the install. It makes pi use this Eva's own folder.
2. Type `/login`, and choose your provider. Never choose Anthropic: a Claude login in pi costs extra money, on top of your subscription.
3. In setup, press Enter at "Claude token". If you log in to pi after setup ends, choose pi in Settings, or run `eva setup` again.

A new chat uses Claude Code, unless only pi has a login. Change the engine for new chats in Settings. You can also choose the engine of each chat.

## Pick your vault

Your vault is a private GitHub repository of notes.

In the terminal, setup first logs in to GitHub:

1. Press Enter at the GitHub question. Setup shows a short code.
2. Open [github.com/login/device](https://github.com/login/device) on any device, and enter the code. Press **Authorize**.
3. Setup lists your 15 most recent repositories. Then:
   - **To use a vault that you have,** type its number or its name, such as `vault`. Eva clones it (makes a copy on this computer).
   - **To start a new vault,** type `0`, and answer the questions about you. Then type a name for its private repository, such as `vault`. Eva creates it from her template.
   - **For no vault now,** press Enter.

On the page, open **Connect GitHub** and press **Log in with GitHub**. Enter the code on GitHub. Then pick or create the vault in **Set up your vault**. To use a token instead, press **Paste a token instead**.

What the GitHub login does:

- It lets Eva and her agents read and write all your repositories, private ones too.
- Eva clones your projects with it. Your agents use it to push their work and open pull requests.
- Eva keeps it on this computer.
- To remove it, press **Log out** on the GitHub card. Eva logs the agents out too. Then revoke the login on GitHub under **Settings > Applications**.
- If the GitHub card says that your agents cannot push their work yet, press **Log in with GitHub** again.

To give Eva only some repositories, paste a token at the GitHub question instead. On GitHub, open **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**. Pick your vault and your projects under **Repository access**. Choose **Read and write** under **Permissions > Contents** and **Permissions > Pull requests**. Then generate the token.

## Connect Telegram (optional)

A bot is a Telegram account that a program controls. Eva talks to you through your own bot.

1. In Telegram, open a chat with **@BotFather** (the official bot that makes bots), and send `/newbot`.
2. Give it a name, such as `My Eva`, and a user name that ends in `bot`, such as `my_eva_123_bot`.
3. BotFather answers with a **token**: a long code such as `123456789:AAH...`. Paste it into setup, or into **Connect Telegram** in Settings. Never share it: whoever has it controls the bot.
4. Pair your chat, so that Eva answers only you. The Telegram card in **Settings > Connections** shows a pairing code, such as `EVA-1A2B3C4D`. On Eva's computer, `eva status` shows it too. Send that code to your bot.
5. Optional: give your bot Eva's face. Save [this picture](../../src/frontends/web/icons/icon-512.png), send `/setuserpic` to BotFather, pick your bot and send the picture.

## Open Eva on your phone

Each device needs the Tailscale app, signed in with the same account as Eva's computer. Then:

1. Open Eva's address. Send `/link` to your bot, or look in **Use Eva from any device** in Settings, if you forget it.
2. The first time, the page shows a short code. Allow the device, for example with `eva devices allow <code>` on Eva's computer, or with **Allow** in Telegram. [Logging in to the web page](reference.md#logging-in-to-the-web-page) lists every way.
3. On a phone, choose "Add to Home screen" in the browser menu. Eva then opens like an app.

You can also set up Tailscale later, from your phone: send `/link` to your bot, or open **Set up phone access** in Settings.

## Add the optional tools

Some features need one more program on Eva's computer. For example, voice notes need ffmpeg and whisper.cpp, and PDFs need typst. **Settings > Updates** installs everything that voice notes need with one button. Run `eva doctor`: it lists each missing tool, the feature that needs it, and how to install it. [Optional features](reference.md#optional-features) tells how to turn on each feature. For Google, you can do most of [Set up Google](reference.md#set-up-google) before you install Eva.

## More than one Eva on a computer

Each Eva has a name, such as `ana` or `ana-1`, and her own vault, bot, settings, logins and port. The port is the number of her web page on the computer, such as `7421`. Two people can share a computer, each with their own Eva. All Evas on a computer share the same programs: git, Claude Code, pi, uv, gh and Tailscale.

To make another Eva, run `eva setup` (the computer has Eva already, so skip the install command). Setup lists the Evas on this computer. Type a new name, and answer setup as for the first Eva. Setup suggests a free name, such as `ana-1` when `ana` exists.

An Eva's page allows the devices of one Tailscale account. For another person's Eva, that is their account:

1. Invite the person to your Tailscale network, on the [Tailscale admin page](https://login.tailscale.com/admin/users). They sign in to the Tailscale app on their phone with their own account.
2. In setup, at "Which account uses this Eva?", pick their account from the list. Enter keeps your own.
3. They open their Eva's address, which ends with her own port, such as `:7421`.

If their phone shows "This account cannot open this Eva", the page names the account and the command that allows it: `eva --instance <name> settings set remoteAccess.allowedTailscaleIdentities '["<account>"]'`. Then restart that Eva.

With more than one Eva, each command asks which Eva. To skip the question, name her: `eva --instance ana status`, or set `EVA_INSTANCE=ana` in the terminal.

Each Eva lives in her own folder, `eva-<name>`, in `~/.config` on Linux or `%APPDATA%` on Windows. Her logins stay there, so two people never share a login or a subscription. Setup prints one command for each login that is missing. Run it in another terminal while setup continues.

The commits of each Eva carry the name of her GitHub account and its private GitHub email. Eva reads the account when you log in to GitHub. To use another name or email, open **Settings > Connections**, and press **Change the commit name and email** in the GitHub card. An Eva with no GitHub login uses the name and email of your global git settings. For hosts other than GitHub, git uses your own login.

**Share a computer user only with people that you trust fully.** All Evas of one computer user can read each other's files, such as notes and tokens. Eva never does this by herself, but nothing on the computer stops it. For people who need privacy from each other, give each person their own computer user, or their own computer.

## Prepare a server that you reach from your desk

Read this when Eva gets her own computer, such as an old laptop with no screen. You set it up once, and then you reach it only over SSH. A coding agent that helps you can follow these steps too.

1. **Install Ubuntu Server LTS** from [ubuntu.com/download/server](https://ubuntu.com/download/server). The Server edition has no desktop, so an old laptop keeps its memory for Eva.
2. **Write the installer to a USB stick with [Rufus](https://rufus.ie).** Choose "ISO Image mode", partition scheme `GPT`, target `UEFI (non CSM)`, file system `FAT32`. Do not use balenaEtcher: old firmware does not see the stick that it makes.
3. **Install with these answers:**
   - **Disk:** use the entire disk, and clear "Set up this disk as an LVM group". Otherwise Ubuntu uses only about 100 GB.
   - **Password:** use only letters and digits. The keyboard layout can change between the installer and the login, and symbols move.
   - **Install OpenSSH server:** yes.
   - **Third-party drivers:** none.
4. **Check the bootloader before you press "Reboot Now".** Some laptops finish with no bootloader, and then show "no bootable device". Open **Help > Enter shell**, and run `ls /target/boot/efi/EFI/BOOT`. If `BOOTX64.EFI` is not there, run these two commands. The first makes the system folders of the installer visible inside the new system. The second installs the bootloader at the path that every firmware reads.

   ```bash
   for d in dev dev/pts proc sys run; do mount --bind /$d /target/$d; done
   chroot /target grub-install --removable
   ```

5. **Connect from your desk.** On the server, run `ip address`, and note the address that starts with `192.168.` or `10.`. On your computer, run `ssh your-user@<address>`.
6. **Log in with a key.** On your computer, run `ssh-keygen -t ed25519 -f ~/.ssh/eva_server`, then `ssh-copy-id -i ~/.ssh/eva_server.pub your-user@<address>`. Windows has no `ssh-copy-id`: append the `.pub` file to `~/.ssh/authorized_keys` on the server instead. Give a coding agent access the same way, and delete its line to remove the access.
7. **Keep the address fixed.** In your router, add a DHCP reservation (a fixed address for this machine) inside the router's DHCP range. Some routers accept an address outside the range and then ignore it.
8. **Keep the server awake** (needs `sudo`):
   - **Closed lid:** create `/etc/systemd/logind.conf.d/eva.conf` with the lines `[Login]` and `HandleLidSwitch=ignore`.
   - **Wi-fi:** use a cable when you can. Some wi-fi cards sleep between packets, and every connection to GitHub then stops for a while. Run `iw dev` to find the card, then `sudo iw dev <card> set power_save off`, and repeat it at each start with a systemd unit.
   - **Power:** keep the laptop plugged in.

Then run [the install command](#1-run-the-install-command) over SSH.

## Install by hand, or from a script

**By hand.** To read each step before it runs, read [install.sh](../../install/install.sh) or [install.ps1](../../install/install.ps1). Or do its steps yourself:

1. Install git, and on Linux curl too.
2. Download `eva-linux-x64`, `eva-linux-arm64` or `eva-windows-x64.exe` from the [latest release](https://github.com/guplem/eva/releases/latest). Save it as `~/.local/bin/eva` and run `chmod +x ~/.local/bin/eva` on Linux, or as `%LOCALAPPDATA%\Programs\Eva\eva.exe` on Windows.
3. Add that folder to your `PATH`. On Linux, run `export PATH="$HOME/.local/bin:$PATH"`. On Windows, add it in the user environment variables, and open PowerShell again.
4. Run `eva setup` in that terminal. The service keeps the `PATH` of setup, and finds uv and the harnesses through it.

**From a script.** Give each answer in an `EVA_*` variable, and add `--non-interactive`. `src/frontends/cli/setup.ts` lists every name. Setup still installs Claude Code, pi, uv and gh; add `EVA_INSTALL_ENGINES="no"` to skip them. With pi, leave out `EVA_CLAUDE_TOKEN`, and add `EVA_ENGINE="pi"`. A script starts Eva only with `EVA_START_SERVICE="yes"`, and never waits for a device code.

```bash
EVA_TIME_ZONE="Europe/Madrid" EVA_VAULT_REPOSITORY="https://github.com/you/vault" EVA_GITHUB_TOKEN="..." EVA_CLAUDE_TOKEN="..." EVA_TELEGRAM_BOT_TOKEN="..." eva setup --non-interactive
```

**Updates.** Eva updates herself from new releases. To update her now, run `eva update`. To repair an install, run the install command again.

**Service.** On Linux, setup runs `loginctl enable-linger`, so that Eva keeps running after you log out. When that fails, it prints the command for an administrator.

On Windows, `eva service install` adds `Eva-<name>` to the programs that Windows starts when you log in (the `Run` list of your user). It needs no administrator, and shows no window. It also removes an `Eva-<name>` task in Task Scheduler, from an older Eva. Task Manager can show the start under **Startup apps** as "Console Window Host". To stop the start at logon, turn it off there. Her icon in the system tray shows that she runs.

If setup cannot start Eva, run `eva service install` to try again, or `eva` to see the error. If Eva crashes, she starts again within a minute.

**Tailscale without `sudo`.** On Linux, Eva installs Tailscale for your user only, with no `sudo`, when no `tailscale` program exists. It also needs `loginctl enable-linger`, so that it keeps running after you log out. `eva doctor` checks it. If Tailscale already runs for the administrator, ask them to run `sudo tailscale set --operator=$USER` once, so that Eva can use it.

## Remove Eva

Run the uninstall command on Eva's computer. It removes only what you allow.

On Linux:

```bash
curl -fsSL https://github.com/guplem/eva/releases/latest/download/uninstall.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://github.com/guplem/eva/releases/latest/download/uninstall.ps1 | iex
```

The command asks before each step. Each question shows the safe answer in `[brackets]`: press Enter to keep it. Press Ctrl+C to stop at any question.

1. **Which Eva.** Type a name, or press Enter to remove every Eva on this computer.
2. **Stop her.** The command stops each Eva that you picked, and removes her start at login. This step asks nothing.
3. **Her folder.** The command asks to delete `eva-<name>`. It holds her settings, logins, logs and copy of your vault. Enter keeps the folder, so a new install finds her again. When the vault copy or a project clone has changes that are not on GitHub yet, the command lists them first.
4. **The eva program.** When no other Eva uses the computer, the command asks to remove the `eva` program. Enter removes it.
5. **The shared programs.** The command asks about each program that Eva installed: pi, gh, ffmpeg, whisper.cpp, Tailscale, Claude Code and uv. Other programs can use them too, so Enter keeps each one.

The command never changes your vault on GitHub, or your own Claude Code settings in `~/.claude`.

Then do these steps outside the computer:

- **GitHub:** revoke Eva's login under **Settings > Applications**. To delete your vault too, open its repository on GitHub, then **Settings**.
- **Telegram:** send `/deletebot` to @BotFather.
- **Tailscale:** remove the computer on the [Machines page](https://login.tailscale.com/admin/machines), if it is still there.
- **Phone:** delete Eva's icon from the home screen.
- **Linux:** setup ran `loginctl enable-linger`. To undo it, run `loginctl disable-linger`.

**By hand.** To read each step before it runs, read [uninstall.sh](../../install/uninstall.sh) or [uninstall.ps1](../../install/uninstall.ps1). Or do the main steps yourself, for each Eva:

- On Linux, run `systemctl --user disable --now eva-<name>`. Then delete `~/.config/systemd/user/eva-<name>.service`, the folder `~/.config/eva-<name>` and the program `~/.local/bin/eva`.
- On Windows, choose **Quit Eva** in the menu of her tray icon, or end each `eva.exe` task in Task Manager. Then run `Remove-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Run Eva-<name>` in PowerShell. Delete the folders `%APPDATA%\eva-<name>` and `%LOCALAPPDATA%\Programs\Eva`, and remove the second one from your `PATH`.
