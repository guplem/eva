# Eva

Eva is a personal "super harness": one service that runs AI coding agents (Claude Code, pi) over a person's vault and projects, from a terminal, Telegram and a web app. TypeScript on Bun.
The code is the source of truth for every fact. `README.md` and `docs/guide/` are for humans.

## What must not change

A change to one of these goals needs the owner.

- **A personal, open-source project.** Keep Eva easy to understand and fast to change. Anyone can work on it with any coding tool.
- **This repository is public: no personal data.** Each person's knowledge lives in their own private vault.
- **Eva works from a phone.** Every problem must reach the phone. A fix that needs a terminal is a gap to close.
- **Plug and play.** Keep settings and setup questions few. Each machine setting has a default that Eva finds on the machine.
- **Each setting has one home.** The person's settings live in the vault. The machine's settings and every security setting stay on the machine. Secrets never go in the vault or this repository.
- **Project mode is a transparent wrapper.** Eva opening a clone equals the person opening it in the harness by hand: Eva adds no prompt and no skills. Assistant mode is Eva's prompt plus the vault's `.eva/` skills.
- **Eva runs existing harnesses** and depends on no single AI vendor. Each person uses their own engine login: a subscription token, never an API key. Never a Claude login through pi.
- **Remote access only through Tailscale.** Never a public tunnel.
- **One core process per instance,** and any number of instances.
- **Eva owns vault sync in her own code.** No agent hooks.
- **The vault layout is a contract.** A project is `Projects/YYYY-MM-DD-HHmm-name/`; its clones live in `repos/<repo>-<n>/`.
- **Windows and Linux are both first-class.**

## Writing style

- **All prose** (chat, PRs, issues, commits, docs, comments) follows Zinsser: simplicity, brevity, clarity, humanity. Short sentences, one idea each, common words, no idioms, no em dashes.
- **Gloss each jargon term** on first use, or pick a simpler word. Lead with the answer.
- **Technical text** (`AGENTS.md`, skills, `README.md`, `docs/`, code comments) also follows ASD-STE100 (Simplified Technical English): active voice, one meaning per word, one instruction per sentence that starts with the verb, about 20 words per sentence at most.
- These rules cover prose only, not code identifiers or quoted text.

## Rules

- **Never write personal data** in a file, commit, issue or PR: no names of private people, employers, machine addresses, tokens or home paths. Use the neutral demo vault and `example-app` style names.
- **Spawn a child process only through a seam** (`ProcessRunner`; pi's `PiProcessStarter`), with an environment from `buildChildEnvironment` and a timeout.
- **Write state files atomically, and read them tolerantly** (`src/shared/files.ts`). A bad file never crashes Eva.
- **Branch on `EvaError` codes,** never on message text.
- **Before you delete a folder, list its git-ignored files** (`git status --ignored -- <folder>`). An ignored file, such as a `.env`, is in no commit, so a delete loses it for good.
- **Comment the why, never the what.**
- **Use one word per concept:** instance, vault, project, clone (never "workspace"), session, fork, turn, engine, front end.
- **A step that only the owner can do** becomes a GitHub issue with the `owner` label. Then continue with fakes.

## Checks

- `bun run check` is exactly what CI and the pre-push hook run. `bun install` installs the hooks.
- The public-content check reads tracked files only (`git add` a new file first). The private denylist lives outside the repository: never copy an entry from it.
- After `bun run build:executable`, run `bash scripts/smoke-executable.sh dist/eva`.

## Renames

- **Stored and sent names are a schema:** config keys, session record fields, event `kind` values and `EvaErrorCode` values. Rename the stored string only with a tolerant read of the old one (lesson 54), and say so in the PR.
- **Change the registration points together:** `.dependency-cruiser.cjs`, `knip.json`, `bunfig.toml`, `package.json`, and the command lists in `src/frontends/cli/arguments.ts` and `src/frontends/telegram/telegram-bot.ts`.
- Rename a CLI command, a Telegram command or a setting key only with the owner.

## Architecture

- Layers: `src/shared/` (types, seams), `src/core/`, `src/engines/<engine>/`, `src/frontends/`, and `src/main.ts` (wiring only). `bun run arch` enforces the imports.
- `templates/vault/` is runtime content that each new vault gets, not rules for agents. It never gets a `CLAUDE.md` (lesson 112).

## Windows

Read lessons 76 to 83 in `docs/lessons-from-v1.md` before you spawn a process, build a path, or order events.

## Test-driven development

Work red-green: write a failing test first, then the smallest code that passes it. A bug fix starts with a test that reproduces the bug.
A commit that changes `src/` with no test change says why in its message.

## Git and GitHub

- Branch with `git checkout -b <branch> origin/main && git push -u origin <branch>`.
- Merge with `gh pr merge --auto --merge`. The ruleset waits for every check. When the branch is behind `main`, run `gh pr update-branch`.
- Never push to a person's vault.
- One owner per branch. Agent worktrees live in `.claude/worktrees/`, which git ignores.
- For each PR: assign yourself, write `Closes #N`, and add the `waiting-for-human-check` label.
- Before each commit, follow `.agents/skills/write-commit/SKILL.md`. Before each rename, follow `.agents/skills/rename-symbol/SKILL.md`.

## Agent files

- Rules live only in `AGENTS.md` files. The nearest folder's file applies first. Each `CLAUDE.md` holds only `@AGENTS.md`.
- Never write a rule that a check enforces, or a fact that the code shows.
- When you learn a hard-won trap, add one line to the nearest `AGENTS.md`.
- Keep each instruction short, with one home per fact. Delete a contradiction when you find one.
- `docs/lessons-from-v1.md` is history. Code comments cite it as "lesson N".
