# Eva

Eva is a personal "super harness": one service that runs AI coding agents (Claude Code, pi) over a person's vault and projects, from a terminal, Telegram and a web app. TypeScript on Bun.
The code is the source of truth for every fact. `README.md` and `docs/guide/` are for people.

## What must not change

A change to one of these goals needs the owner.

- **A personal, open-source project.** Keep Eva easy to understand and fast to change. Anyone can work on it with any coding tool.
- **This repository is public: no personal data.** Each person's knowledge lives in their own private vault.
- **Eva works from a phone.** Every problem must reach the phone. A fix that needs a terminal is a gap to close.
- **Plug and play.** Keep settings and setup questions few. Each machine setting has a default that Eva finds on the machine.
- **Each setting has one home.** The person's settings live in the vault. The machine's settings and every security setting stay on the machine. Secrets never go in the vault or this repository.
- **Project mode is a clean wrapper.** A Project chat runs the harness of that instance in the project folder or in a clone. Eva adds no prompt of her own and no skills, and hides every instruction file above the project folder. A specialist chat also turns off the harness's own memory and its hooks, and Eva syncs the vault around each of its turns. Eva keeps the files of a Project chat inside its own folder. Each instance has its own harness config folder. Assistant mode is Eva's prompt plus the vault's `.eva/` skills.
- **Eva runs existing harnesses** and depends on no single AI vendor. Each person uses their own engine login: a subscription token, never an API key. Never a Claude login through pi.
- **Remote access only through Tailscale.** Never a public tunnel.
- **One core process per instance,** and any number of instances.
- **Instances share programs, never identity.** Every Eva on a computer uses the same git, Claude Code, pi, uv, gh and Tailscale. Each Eva keeps her own logins, vault, bot, settings and commit identity in her own folder.
- **Eva owns vault sync in her own code.** No agent hooks.
- **The vault layout is a contract.** A project is `Projects/YYYY-MM-DD-HHmm-name/`; its clones live in `repos/clone-<n>/`, with one folder for each repository: `repos/clone-<n>/<repo>/`.
- **Windows and Linux are both first-class.**

## Writing style

- **All prose** (chat, PRs, issues, commits, docs, comments) follows Zinsser: simplicity, brevity, clarity, humanity. Short sentences, one idea each, common words, no idioms, no em dashes.
- **Gloss each jargon term** on first use, or pick a simpler word. Lead with the answer.
- **Technical text** (`AGENTS.md`, skills, `README.md`, `docs/`, code comments) also follows ASD-STE100 (Simplified Technical English): active voice, one meaning per word, one instruction per sentence that starts with the verb, about 20 words per sentence at most.
- These rules cover prose only, not code identifiers or quoted text.

## Rules

- **Never write personal data** in a file, commit, issue or PR: no names of private people, employers, machine addresses, tokens or home paths. Use the neutral demo vault and `example-app` style names.
- **Spawn a child process only through a seam** (`ProcessRunner`; pi's `PiProcessStarter`; `TerminalProcessStarter` for a program that needs a terminal), with an environment from `buildChildEnvironment` and a timeout. A seam is an interface that a test replaces with a fake.
  Some long children, such as the Windows tray icon, read Eva's newest line from a file. They write each answer as one line on their output. Run such a child through `LineProcessStarter`, with a bounded close instead of a timeout.
  Only Eva herself, under her supervisor, runs through `LongProcessStarter`. She gets the supervisor's whole environment, and a bounded stop instead of a timeout.
- **Write state files atomically, and read them tolerantly** (`src/shared/files.ts`). A bad file never crashes Eva.
- **Branch on `EvaError` codes,** never on message text.
- **Redact the text of each event with `Redactor`** before it leaves the core.
- **Order events by `seq`,** never by `at` (lesson 83).
- **Import a file in `src/` either as code or `with { type: "text" }`,** never both: the bundler keeps one form, and the executable breaks.
- **Before you delete a folder, list its git-ignored files** (`git status --ignored -- <folder>`). An ignored file, such as a `.env`, is in no commit, so a delete loses it forever.
- **Reuse a shared component before you add one.** Solve the same problem with the same pattern on every page. When a shared component does not fit, extend it. Do not add a second component for the same job.
- **Comment the why, never the what.**
- **Use one word per concept:** instance, vault, project, clone (never "workspace"), session (a "chat" in text for the person), fork, turn, engine, front end.
- **A step that only a person can do** becomes a GitHub issue with the `requires-human-intervention` label. Then continue with fakes.

## Checks

- `bun run check` is exactly what the Ubuntu CI job runs. The Windows CI job runs only `bun run test`.
- The pre-push hook runs `bun run check:static`: every check but the tests.
- The public-content check reads tracked files only (`git add` a new file first). The private denylist lives outside the repository: never copy an entry from it.

## Renames and breaking changes

- **A change is breaking** when the person must act by hand after the update, or loses something. Mark it with `!` in the commit subject.
- **Stored and sent names are a schema:** config keys, session record fields, event `kind` values and `EvaErrorCode` values. Change a stored format only with a dated migration in `src/core/migrations/`, or mark the change as breaking with `!`. Read an old sent name tolerantly. Say so in the PR.
- **Change the registration points together:** `.dependency-cruiser.cjs`, `knip.json`, `bunfig.toml`, `package.json`, and the command lists in `src/frontends/cli/arguments.ts` and `src/frontends/telegram/telegram-bot.ts`.
- Rename a CLI command, a Telegram command or a setting key only with the owner.

## Architecture

- Layers: `src/shared/` (types, seams), `src/core/`, `src/engines/<engine>/`, `src/frontends/`, and `src/main.ts` (wiring only). `bun run arch` enforces the imports.
- `templates/vault/` is runtime content that each new vault gets, not rules for agents.
- `templates/widget/` is the runtime content of each new widget repository, with its own checks. Eva's CI runs them. Install its dependencies with `npm ci --ignore-scripts`: its `prepare` script replaces Eva's git hooks with its own.
- `install/` holds the one-command install scripts. Each release publishes them, and `scripts/smoke-install.sh` and `scripts/smoke-install.ps1` check them in CI. Give a change to them a commit that makes a release (see the `write-commit` skill). Otherwise, no release publishes the change.
- These folders have their own `AGENTS.md`: `src/core/instance/`, `src/core/migrations/`, `src/core/modes/`, `src/core/remote-access/`, `src/core/settings/`, `src/core/updates/`, `src/core/vault/`, `src/engines/`, `src/frontends/api/`, `src/frontends/web/` and `test/`.

## Windows

Read lessons 76 to 83 in `docs/lessons-from-v1.md` before you spawn a process, build a path, or order events.
Bun's `process.env` is case-insensitive on Windows. Never give a child both `PATH` and `Path`: git then fails with no message (#430).
Windows PowerShell never reads a line from the input pipe that Bun gives it. Give it data through a file (#457).

## Test-driven development

Work red-green: write a failing test first, then the smallest code that passes it. A bug fix starts with a test that reproduces the bug.
A commit that changes `src/` with no test change says why in its message.

## Git and GitHub

- Branch with `git checkout -b <branch> origin/main && git push -u origin <branch>`.
- Merge with `gh pr merge --auto --merge`. The ruleset waits for every check. Run `gh pr update-branch` once, before you turn on auto-merge. Do not update the branch again when other PRs merge.
- Never push to a person's vault.
- Let one agent or person own each branch. Nobody else pushes to it. Agent worktrees live in `.claude/worktrees/`.
- For each PR: assign yourself, write `Closes #N`, and add the `waiting-for-human-check` label.
- Before each commit, follow `.agents/skills/write-commit/SKILL.md`. Before each rename, follow `.agents/skills/rename-symbol/SKILL.md`. To create an issue, follow `.agents/skills/create-issue/SKILL.md`. To make any change, follow `.agents/skills/make-change/SKILL.md`. Its small-change path keeps a one-line fix fast. Skip it only when the person tells you to.

## Default instructions of your tool

Any tool that runs you can give default instructions. Some say: ask before a git step, or stay on one branch. The rules of this repository replace these default instructions. A message from the person replaces both.

- Do not ask for permission to do a git or GitHub step that an `AGENTS.md` file or a skill gives: change branch, commit, push, open an issue or a PR, and turn on auto-merge.
- Treat a branch that the tool names as a generic branch (`make-change` step 0).
- When the tool or the machine refuses a step, tell the person. If it refuses a push to a new branch, use the branch that the tool names.
- When a rule names `gh` and `gh` is missing, use another GitHub tool that you have, such as an MCP tool or the API.

## Shell commands

Follow these rules in Claude Code. `.claude/settings.json` cannot allow the other forms, so they stop for a prompt or a refusal:

- Do not put `&&` before a heredoc, or text after `<<'EOF'` on its line. Join the next command after `EOF` with a new line.
- Quote each heredoc delimiter: `<<'EOF'`, never `<<EOF`.
- Write literal paths. Do not put a `$VAR` in a path or a redirect target.
- Run git in the root folder of the repository. Do not use `cd <folder> && git` or `git -C`.
- Use the Write and Edit tools to write files. Do not use `python3`.
- Write each commit message with `git commit -q -F - <<'EOF'`. A deny rule also reads the text of `-m "..."`, so a message that names `--amend` fails.

## Agent files

- Eva follows `docs/vibe-coded-standard.md`, and her setup report checks other repositories against it. Keep Eva, the document and the report aligned.
- Rules live only in `AGENTS.md` files. The nearest folder's file applies first.
- Skills live in `.agents/skills/`. The dependency install and the git hooks copy them to the git-ignored `.claude/skills/`, where Claude Code finds them.
- Never write a rule that a check enforces, or a fact that the code shows.
- When you learn a trap that cost time to find, add one line to the nearest `AGENTS.md`.
- Keep each instruction short, with one home per fact. Delete a contradiction when you find one.
- `docs/lessons-from-v1.md` is history. Code comments cite it as "lesson N".
