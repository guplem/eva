# Eva

**Eva is a personal AI assistant that runs on a computer of your own.** You talk to her from your phone (Telegram, or a web page), and she remembers everything in a private notebook that only you own.

**Eva is a "super harness".** A harness is a program that runs an AI agent, such as Claude Code or pi. Eva does not think by herself: she runs these harnesses for you, and organizes their work. One program gives you one chat, one notebook and one list of projects, whichever harness does the work.

## How Eva works, in one picture

Think of Eva as a helper who lives in one computer at your home:

| Piece                 | In everyday words                                                                                                        | Technical name               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| **The helper's desk** | A computer that stays on, such as an old laptop. Eva runs there.                                                         | the hub                      |
| **The notebook**      | A private folder of notes. Eva reads and writes it, and keeps a copy on GitHub so that nothing gets lost.                | the vault (a git repository) |
| **The brain**         | An AI service that does the thinking, with your own subscription.                                                        | the engine (Claude Code, pi) |
| **The phone line**    | How you talk to Eva: a Telegram chat, or her web page.                                                                   | the front ends               |
| **The private road**  | A free app that connects your phone and computers to the helper's desk, and to nothing else. Strangers cannot reach Eva. | Tailscale                    |

Eva can also work in your coding projects. Each project gets its own copy of the code, and an AI coding agent works there as if you had opened the folder yourself.

## What you need

Before you start, have these ready. Each one takes a few minutes.

1. **A computer that stays on.** Windows or Linux: an old laptop, a desktop, or a rented server in the cloud.
2. **An AI subscription** for the harness that does the thinking. Use a Claude subscription (Pro or Max) from [claude.ai](https://claude.ai) with Claude Code, or another provider with pi, such as ChatGPT or OpenRouter.
3. **A GitHub account** from [github.com](https://github.com). Eva keeps a private copy of your notes there.
4. **Telegram** on your phone, and [a bot of your own](docs/guide/setup.md#create-your-telegram-bot). It is optional, but it is the easiest way to talk to Eva.

To open Eva's web page from your phone, you also need **Tailscale** (free). You can add it later. `eva setup` installs it for you.

## Get started

The full guide, with every step, is [docs/guide/setup.md](docs/guide/setup.md). In short:

1. **Install the tools** on the computer that stays on: [git](https://git-scm.com/downloads), and your harness: [Claude Code](https://claude.ai/code) or [pi](https://pi.dev).
2. **Download Eva:** one program from the [latest release](https://github.com/guplem/eva/releases/latest). [Install Eva on Windows](docs/guide/setup.md#install-eva-on-windows) and [Install Eva on Linux](docs/guide/setup.md#install-eva-on-linux) give the commands.
3. **Answer Eva's questions:**

   ```bash
   eva setup
   ```

   Eva asks for your notebook, your AI login, your Telegram bot, and the Tailscale sign-in. She checks the notebook's address before she continues.

4. **Start Eva, and let her start by herself from now on:**

   ```bash
   eva service install
   ```

5. **Pair your Telegram chat.** Run `eva status`. It shows a short pairing code; send it to your bot. From then on, Eva answers only you.

Eva updates herself from new releases. You choose which ones in Settings.

## Use Eva every day

### In Telegram

Write to your bot as you write to a person. Eva answers in the same chat. Each new topic (`/new`) is a separate conversation. Telegram, the web page and the terminal share the same conversations: see [Conversations](docs/guide/reference.md#conversations).

| Command      | What it does                                  |
| ------------ | --------------------------------------------- |
| `/new`       | Start a new conversation                      |
| `/chats`     | Pick any conversation to continue here        |
| `/delete`    | Delete this conversation everywhere           |
| `/rename`    | Give this conversation a new name             |
| `/stop`      | Stop what Eva is doing in this conversation   |
| `/status`    | Show whether everything is all right          |
| `/logs`      | Show Eva's last warnings and errors           |
| `/restart`   | Restart Eva (she asks you to confirm first)   |
| `/link`      | Show the address of Eva's web page            |
| `/sync`      | Save the notebook now                         |
| `/conflicts` | Pick a version of each note in a conflict     |
| `/update`    | Check for updates, or pick a version of Eva   |
| `/projects`  | Search your projects: `status:active`, `#tag` |
| `/schedules` | List your reminders and repeated tasks        |
| `/help`      | Show all the commands                         |

You can also send voice notes, photos and files.

### On the web page

Eva's web page shows all your conversations, your projects and the settings. Its address looks like `https://your-computer.your-tailnet.ts.net`. Send `/link` in Telegram to get it. [Open Eva on your phone](docs/guide/setup.md#open-eva-on-your-phone) gives the steps.

A device without Tailscale cannot open Eva. That is on purpose: Eva can act on your computer, so only your own devices may reach her.

To change a project's title, status, tags or repositories, open the project in the list and press **Project details**.

Open **Settings** on the web page to change the updates, the notebook sync, the hub and the tokens. [Settings](docs/guide/reference.md#settings) explains each one.

## Words you will see

| Word          | Meaning                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vault**     | Your notebook: the private folder of notes that Eva reads and writes, saved on GitHub.                                                          |
| **Hub**       | The computer that runs your Telegram bot and your reminders. Only one computer is the hub.                                                      |
| **Satellite** | Any other computer with Eva and the same notebook. It keeps the notebook in step, but stays quiet in Telegram.                                  |
| **Token**     | A long secret code that works like a password for one service. Never share it. Eva keeps each token on her own computer, never in the notebook. |
| **Tailscale** | A free app that links your own devices privately, so your phone can open Eva's page from anywhere.                                              |
| **Project**   | A folder in your notebook for one piece of work, often with code on GitHub.                                                                     |
| **Sync**      | Saving the notebook to GitHub, and bringing in what other computers saved.                                                                      |

## Problems and answers

**Eva tells you when something goes wrong.** She sends a message to your Telegram chat when a problem starts, once a day while it lasts, and once more when it ends. The web page shows the open problems at the top, and `/status` starts with "All good" or the number of problems. Send `/logs` to see the details.

**Eva does not answer in Telegram.**
Open the web page and look at Settings, or run `eva status` on Eva's computer. Check that the computer is on and connected. If you run Eva on two computers, check which one is the hub.

**The web page does not open on my phone.**
Open the Tailscale app and check that it says "Connected", with the same account as Eva's computer. Then send `/link` in Telegram and open that exact address.

**Eva says "conflict" for the notebook.**
Two computers changed the same note. Eva stops saving to GitHub until you pick a version, so that nothing is lost. Send `/conflicts` in Telegram: see [Notebook conflicts](docs/guide/reference.md#notebook-conflicts).

**Something else.**
Run `eva doctor` on Eva's computer. It lists the tools that are missing, and how to install each one.

## More guides

- [docs/guide/setup.md](docs/guide/setup.md): the full installation, step by step, for Windows and for Linux.
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
