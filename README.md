# Eva

**Eva is a personal AI assistant that runs on a computer of your own.** You talk to her from your phone (Telegram, or a web page), and she remembers everything in a private notebook that only you own.

Some things you can ask her:

- "Remind me every Monday at 9 to pay the rent."
- "What did I write about the car insurance?"
- "Save this photo of the receipt with my expenses."
- "Send me my notes about the trip as a PDF."
- "In the website project, fix the broken contact form and open a pull request."

**Status:** Eva works and runs every day for her author, but she is young. Expect rough edges, and read [Problems and answers](#problems-and-answers).

## How Eva works, in one picture

Think of Eva as a helper who lives in one computer at your home:

| Piece                 | In everyday words                                                                                                        | Technical name               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| **The helper's desk** | A computer that stays on, such as an old laptop. Eva runs there.                                                         | the hub                      |
| **The notebook**      | A private folder of notes. Eva reads and writes it, and keeps a copy on GitHub so that nothing gets lost.                | the vault (a git repository) |
| **The brain**         | An AI service that does the thinking. Eva uses your own Claude subscription.                                             | the engine (Claude Code)     |
| **The phone line**    | How you talk to Eva: a Telegram chat, or her web page.                                                                   | the front ends               |
| **The private road**  | A free app that connects your phone and computers to the helper's desk, and to nothing else. Strangers cannot reach Eva. | Tailscale                    |

Eva can also work in your coding projects. Each project gets its own copy of the code, and an AI coding agent works there as if you had opened the folder yourself.

## What you need

Before you start, have these ready. Each one takes a few minutes.

1. **A computer that stays on.** Windows or Linux. An old laptop is enough.
2. **A Claude subscription** (Pro or Max) from [claude.ai](https://claude.ai). Eva uses it for the thinking.
3. **A GitHub account** from [github.com](https://github.com). Eva keeps a private copy of your notes there.
4. **Telegram** on your phone, and a bot of your own. A bot is a Telegram account that a program controls. [Create your Telegram bot](docs/guide/setup.md#create-your-telegram-bot) explains the 2-minute steps.
5. **Tailscale** (free) from [tailscale.com](https://tailscale.com), to open Eva's web page from your phone. You can add it later.

## Get started

The full guide, with every step, is [docs/guide/setup.md](docs/guide/setup.md). In short:

1. **Install the tools** on the computer that stays on: [git](https://git-scm.com/downloads), [Bun](https://bun.sh/), and [Claude Code](https://claude.ai/code).
2. **Get Eva:**

   ```bash
   git clone https://github.com/guplem/eva.git
   cd eva
   bun install
   ```

3. **Answer Eva's questions:**

   ```bash
   bun run eva setup
   ```

   Eva asks for your notebook, your Claude login, your Telegram bot, and the Tailscale sign-in. She checks the notebook's address before she continues.

4. **Start Eva, and let her start by herself from now on:**

   ```bash
   bun run eva service install
   ```

5. **Pair your Telegram chat.** Run `bun run eva status`. It shows a short pairing code; send it to your bot. From then on, Eva answers only you.

## Use Eva every day

### In Telegram

Write to your bot as you write to a person. Eva answers in the same chat. Each new topic (`/new`) is a separate conversation.

| Command      | What it does                                  |
| ------------ | --------------------------------------------- |
| `/new`       | Start a new conversation                      |
| `/rename`    | Give this conversation a new name             |
| `/stop`      | Stop what Eva is doing in this conversation   |
| `/status`    | Show whether everything is all right          |
| `/logs`      | Show Eva's last warnings and errors           |
| `/restart`   | Restart Eva (she asks you to confirm first)   |
| `/link`      | Show the address of Eva's web page            |
| `/sync`      | Save the notebook now                         |
| `/update`    | Check for updates, or pick a version of Eva   |
| `/projects`  | Search your projects: `status:active`, `#tag` |
| `/schedules` | List your reminders and repeated tasks        |
| `/help`      | Show all the commands                         |

You can also send voice notes, photos and files.

### On the web page

Eva's web page shows all your conversations, your projects and the settings. Its address looks like `https://your-computer.your-tailnet.ts.net`. Send `/link` in Telegram to get it.

1. Install the Tailscale app on the phone or computer, and sign in with the same account that you used on Eva's computer.
2. Open the address. The first time on each device, the page shows a short code, and Eva asks in Telegram whether to allow it. Tap **Allow** when the code matches. That device then stays logged in for a year.
3. On a phone, choose "Add to Home screen" in the browser menu. Eva then opens like an app.

A device without Tailscale cannot open Eva. That is on purpose: Eva can act on your computer, so only your own devices may reach her.

To change a project's title, status, tags or repositories, open the project in the list and press **Project details**. The same page shows the project's whole `AGENTS.md` for any other change.

### Settings

Open **Settings** on the web page. The most useful ones:

- **Install updates automatically:** how often Eva looks for a new version. She installs it only when no conversation is running.
- **Eva installs by herself:** fixes only, fixes and new features (the default), or every release. A major release can break things that work today.
- **Fetch the notebook's changes:** how often Eva brings in notes that another computer saved.
- **Make this machine the hub:** when Eva runs on more than one computer, this chooses which one answers in Telegram.
- **Tokens and Test:** paste the GitHub, Telegram and Claude Code tokens, then press **Test** to check each part. Only a login with the token can change a token.

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
Open the web page and look at Settings, or run `bun run eva status` on Eva's computer. Check that the computer is on and connected. If you run Eva on two computers, check which one is the hub.

**The web page does not open on my phone.**
Open the Tailscale app and check that it says "Connected", with the same account as Eva's computer. Then send `/link` in Telegram and open that exact address.

**Eva says "conflict" for the notebook.**
Two computers changed the same note. Eva stops saving to GitHub until a person fixes it, so that nothing is lost. The fix needs a terminal on Eva's computer: see [Notebook conflicts](docs/guide/reference.md#notebook-conflicts).

**Something else.**
Run `bun run eva doctor` on Eva's computer. It lists the tools that are missing, and how to install each one.

## More guides

- [docs/guide/setup.md](docs/guide/setup.md): the full installation, step by step, for Windows and for a Linux server.
- [docs/guide/reference.md](docs/guide/reference.md): every command and setting, several computers, updates, and the optional features (voice notes, PDFs, Google Calendar).

## For developers

Eva is written in TypeScript and runs with Bun. [AGENTS.md](AGENTS.md) describes the architecture and the rules of the code; it is written for AI coding agents and for developers. Its section "What must not change" lists the goals that guide every change.

| Task                                       | Command          |
| ------------------------------------------ | ---------------- |
| Install the dependencies and the git hooks | `bun install`    |
| Run every check                            | `bun run check`  |
| Format the code                            | `bun run format` |
| Run the tests                              | `bun test`       |

`bun run check` runs the same checks as the continuous integration (CI) on every pull request: format, lint, types, architecture rules, dead code, a personal-data check, and the tests with coverage.

| Document                                           | What it holds                                 |
| -------------------------------------------------- | --------------------------------------------- |
| [docs/lessons-from-v1.md](docs/lessons-from-v1.md) | What the previous version, Wall-I v1, learned |

Steps that only the owner can do are GitHub issues with the `owner` label.

## License

MIT. See [LICENSE](LICENSE).
