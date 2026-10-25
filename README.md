# Eva

<p align="center"><img src="docs/design/eve/eva.svg" width="160" height="160" alt="Eva's face: a black visor with two glowing blue eyes that look around and blink."></p>

**Eva is a personal AI assistant that runs on a computer of your own.** You talk to her from your phone, your computer or any other device, through Telegram or her web page. She keeps what she learns in your vault, a private folder of notes that only you own.

**Eva is a "super harness".** A harness is a program that runs an AI agent, such as Claude Code or pi. Eva does not think by herself: she runs these harnesses for you, and organizes their work. You can change the harness, and keep the same chats, notes and projects.

## How Eva works

Think of Eva as a helper who lives in one computer at your home:

| Piece                 | In everyday words                                                                                                        | Technical name               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| **The helper's desk** | A computer that stays on, such as an old laptop. Eva runs there.                                                         | the hub                      |
| **The vault**         | A private folder of notes. Eva reads and writes it, and keeps a copy on GitHub so that nothing gets lost.                | a git repository             |
| **The brain**         | An AI harness that does the thinking, with your own subscription.                                                        | the engine (Claude Code, pi) |
| **The phone line**    | How you talk to Eva: a Telegram chat, or her web page.                                                                   | the front ends               |
| **The private road**  | A free app that connects your phone and computers to the helper's desk, and to nothing else. Strangers cannot reach Eva. | Tailscale                    |

## What you need

1. **A computer that stays on,** with Windows or Linux: an old laptop, a desktop, or a rented server in the cloud.
2. **An AI subscription:** Claude, or another provider through pi, such as ChatGPT.
3. **A GitHub account.** Eva keeps a private copy of your notes there.
4. **Optional:** Telegram on your phone, to chat with Eva, and Tailscale (free), to open her page from your phone or any other device.

## Get started

Run one command on the computer that stays on. It also works over SSH, a secure terminal connection from another computer.

- Linux:

  ```bash
  curl -fsSL https://github.com/guplem/eva/releases/latest/download/install.sh | sh
  ```

- Windows, in PowerShell:

  ```powershell
  irm https://github.com/guplem/eva/releases/latest/download/install.ps1 | iex
  ```

The command installs what Eva needs, and starts `eva setup`. Setup starts Eva and shows her address. Open it on your phone, and finish there, or in the terminal. [docs/guide/setup.md](docs/guide/setup.md) explains each step.

Eva updates herself from new releases. You choose which ones in **Settings > Updates**.

## Use Eva every day

### In Telegram

Write to your bot as you write to a person. Eva answers in the same Telegram chat. Each Telegram topic (a thread inside your bot's Telegram chat) is a separate Eva chat. Send `/new` to start one. Telegram, the web page and the terminal share the same chats: see [Chats](docs/guide/reference.md#chats).

Type `/` in the Telegram chat to see all the commands, with a short note for each.

You can also send voice notes, photos and files.

### On the web page

Eva's web page shows your chats, your projects, your files, your schedules (reminders) and the settings. Its address looks like `https://your-computer.your-tailnet.ts.net`: send `/link` in Telegram to get it. See [Open Eva on your phone](docs/guide/setup.md#open-eva-on-your-phone).

On Eva's own computer, run `eva open` to open her page. On Windows, her icon next to the clock opens it too: see [Open Eva on her own computer](docs/guide/setup.md#open-eva-on-her-own-computer).

A device without Tailscale cannot open Eva. That is on purpose: Eva can act on your computer, so only your own devices may reach her.

[Settings](docs/guide/reference.md#settings) explains each setting.

## Words you will see

| Word          | Meaning                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vault**     | Your private folder of notes, which Eva reads and writes, saved on GitHub.                                                                   |
| **Hub**       | The computer that runs your Telegram bot and your schedules. Only one computer is the hub.                                                   |
| **Satellite** | Any other computer with Eva and the same vault. It keeps the vault up to date, but stays quiet in Telegram.                                  |
| **Token**     | A long secret code that works like a password for one service. Never share it. Eva keeps each token on her own computer, never in the vault. |
| **Tailscale** | A free app that links your own devices privately, so your phone can open Eva's page from anywhere.                                           |
| **Project**   | A folder in your vault for one piece of work, often with code on GitHub.                                                                     |
| **Sync**      | Saving the vault to GitHub, and getting what other computers saved.                                                                          |

## Problems and answers

**Eva tells you when something goes wrong.** She sends a message to your Telegram chat when a problem starts, once a day while it lasts, and once more when it ends. A tap on Eva's face on the web page opens the notification center: the open problems with their fix, and the last 30 days of notices. `/status` starts with "All good" or the number of problems. Send `/logs` to see the details.

**Eva does not answer in Telegram.**
Open the web page and look at Settings, or run `eva status` on Eva's computer. Check that the computer is on and connected. If you run Eva on two computers, check which one is the hub.

**The web page does not open on my phone.**
Open the Tailscale app and check that it says "Connected", with the same account as Eva's computer. Then send `/link` in Telegram and open that exact address.

**Eva says "conflict" for the vault.**
Two computers changed the same note. Eva stops saving to GitHub until you pick a version, so that nothing is lost. Send `/conflicts` in Telegram: see [Vault conflicts](docs/guide/reference.md#vault-conflicts).

**Something else.**
Run `eva doctor` on Eva's computer. It lists the tools that are missing, and how to install each one.

## More guides

- [docs/guide/setup.md](docs/guide/setup.md): the full installation, step by step, for Windows and for Linux. Its last section, [Remove Eva](docs/guide/setup.md#remove-eva), removes Eva again.
- [docs/guide/reference.md](docs/guide/reference.md): every command and setting, several computers, updates, and the optional features (voice notes, PDFs, Google Calendar).

## For developers

Eva is written in TypeScript and runs with Bun. [AGENTS.md](AGENTS.md) describes the architecture and the rules of the code; it is written for AI coding agents and for developers. Its section "What must not change" lists the goals that guide every change.

To run Eva from source, clone this repository and run `bun install`. Then type `bun run eva` where the guides say `eva`. A copy from source updates itself from `main`, not from releases.

| Task                                       | Command          |
| ------------------------------------------ | ---------------- |
| Install the dependencies and the git hooks | `bun install`    |
| Run every check                            | `bun run check`  |
| Format the code                            | `bun run format` |
| Run the tests                              | `bun run test`   |

`bun run check` runs the same checks as the continuous integration (CI, the checks that GitHub runs) on every pull request.

[docs/lessons-from-v1.md](docs/lessons-from-v1.md) holds what the previous version, Wall-I v1, learned.

Steps that only a person can do are GitHub issues with the `requires-human-intervention` label.

## License

MIT. See [LICENSE](LICENSE).
