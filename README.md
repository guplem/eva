# Eva

Eva is a personal "super harness": one service that runs AI coding agents over your notes and your projects. You reach her from a terminal, Telegram, or a web page.

Eva keeps your notes in a private git repository (the vault) and saves them for you. She opens each project in its own clone, so a coding agent works there exactly as if you had opened the folder yourself. She runs Claude Code today, and pi as a fallback for other AI subscriptions.

**Status:** under construction. The design is approved, and the core is being built. Most commands do not work yet.

## Run from source

Eva runs from source until the first release. You need [git](https://git-scm.com/) and [Bun](https://bun.sh/) 1.4 or newer.

```bash
git clone https://github.com/guplem/eva.git
cd eva
bun install
bun run eva
```

`bun run eva` starts Eva in the terminal. Later versions add `bun run eva setup` (guided setup) and `bun run eva doctor` (a check of the tools that each feature needs).

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
