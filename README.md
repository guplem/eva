# Eva

Eva is a personal "super harness": one service that runs AI coding agents over your notes and your projects. You reach her from a terminal, Telegram, or a web page.

Eva keeps your notes in a private git repository (the vault) and saves them for you. She opens each project in its own clone, so a coding agent works there exactly as if you had opened the folder yourself. She runs Claude Code today, and pi as a fallback for other AI subscriptions.

**Status:** under construction. The core, the terminal chat, Telegram, the web page, schedules, files and voice notes work with test doubles. No release exists yet.

## Install

Download the executable for your machine from [GitHub Releases](https://github.com/guplem/eva/releases): `eva-windows-x64.exe`, `eva-linux-x64` or `eva-linux-arm64`. You also need [git](https://git-scm.com/). Then run:

```bash
eva setup
```

`eva setup` asks for each setting. Give it an empty folder as the vault, and it creates a new vault there from Eva's template, with a private GitHub repository when you name one. `eva update` replaces the executable with the latest release, after a check of its signature.

## Run from source

You need [git](https://git-scm.com/) and [Bun](https://bun.sh/) 1.4 or newer.

```bash
git clone https://github.com/guplem/eva.git
cd eva
bun install
bun run eva
```

| Command                               | What it does                                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `bun run eva setup`                   | Asks for each setting (vault folder, tokens) and writes the config.                                            |
| `bun run eva doctor`                  | Checks the tools that each feature needs, and says how to install each.                                        |
| `bun run eva`                         | Runs Eva in the foreground: the local web page, Telegram, and schedules.                                       |
| `bun run eva chat`                    | Talks to a running Eva in this terminal.                                                                       |
| `bun run eva service install`         | Starts Eva by itself when you log in.                                                                          |
| `bun run eva setup --non-interactive` | Reads each answer from an `EVA_*` variable instead, for scripts. `src/frontends/cli/setup.ts` lists the names. |

Eva keeps her settings in her home folder: `~/.config/eva` on Linux, `%APPDATA%\eva` on Windows. `config.json` holds the settings and `secrets.json` the tokens.

## Optional features

Each feature below stays off until you set it up. `eva doctor` shows which tools are missing.

- **Schedules.** Ask Eva for a reminder or a daily summary, or use **Add schedule** on the Settings page. Eva writes `.eva/schedules.json` in the vault. Before a schedule first runs, Telegram shows a setup card with every field: check it. Only the hub instance (`"role": "hub"`) runs schedules.
- **Files.** Eva can send a vault file in Telegram, and saves each file that you send her in `Scratch/received/` in the vault. Git never saves `Scratch/`, and Eva deletes its files after a week.
- **PDFs.** Install [typst](https://github.com/typst/typst/releases). Eva then writes a PDF in `Scratch/` and sends it.
- **Voice notes.** Install [ffmpeg](https://ffmpeg.org/download.html) and [whisper.cpp](https://github.com/ggml-org/whisper.cpp), download a model (for example `ggml-base.bin`), and set `voice.modelPath` in `config.json`. The audio never leaves the machine.
- **Google (Calendar, Drive, Contacts, Tasks).** Install [uv](https://docs.astral.sh/uv/). Create an OAuth client in Google Cloud, of type "Desktop app", and set its publishing status to "In production" so that the login does not expire after 7 days. Put its id and secret in `secrets.json` as `googleOauthClientId` and `googleOauthClientSecret`, and your account in `config.json` as `google.email`. The first Google request gives you a link to log in. Eva starts with read-only access; set `google.readOnly` to `false` to let her add events. She asks you before any change that reaches other people, such as an invitation.

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
