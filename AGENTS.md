# Eva

> This file is for AI coding agents and developers who change Eva's code. To install or use Eva, read [README.md](README.md).

Eva is a personal "super harness": one service that runs AI coding agents (Claude Code, pi) over a person's knowledge vault and projects. A terminal, Telegram, and a web app are her front ends. This repository is the public engine; each person's vault is a separate private repository. Written in TypeScript and run with Bun.

`docs/plan.md` is the design source of truth, approved by the owner on 2026-10-14. Read the plan section for the area that you change before you write code. A change to an approved decision (plan §1) needs the owner: add it to `docs/owner-todo.md` and continue with the current decision. Human setup: `README.md`.

Delegate to these agents at the right moment (each agent's own description says what it does). They fall into two groups, by when they run.

**Before you implement (explore agents, launched as preparation):**

- **pattern-scout**: before implementing any non-trivial module, seam, adapter, or front-end command, and any time you ask "how do we do X here?". Returns real code examples with the rules distilled from them.
- **adr-checker** (consult mode): before implementing in an ADR-relevant area (the "Architecture Decision Records (ADRs)" section lists them). Returns the decisions the work must follow.

**After you implement, before you ship:**

- **docs-checker**: after a change that could affect documented content. Checks every documentation location (code comments, `README.md`, `AGENTS.md`, ADRs, `docs/`) against the code and fixes drift.
- **validate**: just before you create a PR or push. Runs `bun run check` the way CI does and reports pass or fail.
- **adr-checker** (maintain mode): after you introduce a new architectural pattern or change one an ADR records. Creates or updates the ADR.

Beyond these, spawn subagents freely: hand off research, code exploration, and parallel analysis so the files they read stay out of your own context. Give each subagent one task.

## Writing style

The people who read your output may read English as a second language and may be new to the area. Two layers apply. This section is the one home for both: no other file restates them.

**Layer 1 covers every piece of prose you write**: chat replies, PR and issue text, review comments, commit messages, and every document below. It follows Zinsser's four principles, which are simplicity, brevity, clarity, and humanity.

- **Short sentences, one idea each.** Use common words. Avoid idioms, slang, and cultural references.
- **Lead with the answer**, then only the detail that changes what the reader does. Cut filler and hedging. Do not use em dashes.
- **Assume a short attention span.** The reader usually skims to make a quick decision (which PR to review, which issue to pick), with little context and little time; put the single most important thing first, and make each part land even if they stop after the first line.
- **Gloss each jargon term, acronym, or tool/library name on first use** in one short clause, or pick a simpler word.
- **Explain a concept briefly before going deeper.** Do not assume a flow, tool, or pattern is already known.
- **Assume junior-level knowledge of the area.** Name the things you reference (files, commands, terms) instead of assuming the reader can guess.

**Layer 2 adds ASD-STE100 on top, for technical documents only**: `AGENTS.md`, ADRs, `README.md`, `docs/`, skills, subagents, and code comments. ASD-STE100 (Simplified Technical English) is a controlled-English standard from the aerospace industry. A maintenance manual must carry one reading and one only, and these documents have the same job.

- **Active voice only.** Name the actor: "the hook formats the file", not "the file gets formatted".
- **One meaning per word, and the same word for the same thing every time.** Never swap in a synonym for variety.
- **One instruction per sentence, and start the sentence with the verb.** Write "Run the migration", not "The migration should be run".
- **No `-ing` verb form as a noun or as a sentence opener.** Write "Use the skill to create a branch", not "Creating a branch is done with the skill".
- **About 20 words per sentence at most** (25 in descriptive text).
- **Leave out no word that guards the meaning.** Write "the file that you changed" when "the file you changed" could be misread.

Both layers cover prose only. Neither covers code identifiers or text you quote word for word.

## Commands

Run every command from the repository root.

| Task                                | Command                    | Notes                                                                                                         |
| ----------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Install dependencies                | `bun install`              | CI runs `bun install --frozen-lockfile` with Bun 1.4.2.                                                       |
| Install the git hooks               | `bunx lefthook install`    | Once per clone. No install script does it for you.                                                            |
| Run every check, the way CI runs it | `bun run check`            | Format check, lint, typecheck, architecture, dead code, public content, tests with coverage. Stops at a fail. |
| Format the whole repo               | `bun run format`           | Prettier. Fix a `format:check` failure with this.                                                             |
| Check the format only               | `bun run format:check`     |                                                                                                               |
| Lint                                | `bun run lint`             | ESLint with `typescript-eslint` `strictTypeChecked`.                                                          |
| Typecheck                           | `bun run typecheck`        | `tsc --noEmit`. Success prints nothing.                                                                       |
| Check the layer rules               | `bun run arch`             | dependency-cruiser with `.dependency-cruiser.cjs`.                                                            |
| Find dead code                      | `bun run deadcode`         | knip.                                                                                                         |
| Check for personal data             | `bun run public-content`   | Home paths, plus the private denylist when it exists (see Gotchas).                                           |
| Run the tests                       | `bun test`                 | Add a path or `-t <name>` to run fewer.                                                                       |
| Run the tests with coverage         | `bun run test:coverage`    | Fails under 90% lines or functions.                                                                           |
| Run mutation testing                | `bun run mutation`         | Stryker on `src/core` and `src/engines`. Slow: CI runs it nightly. Breaks under 60.                           |
| Run Eva from source                 | `bun run eva [subcommand]` |                                                                                                               |
| Build the single executable         | `bun run build:executable` | Writes `dist/eva`. `bash scripts/smoke-executable.sh dist/eva` starts it the way a new person does.           |

Whenever you need to confirm the code still passes, delegate to the **validate** agent (it runs `bun run check` the way CI does).

## Architecture

The layers of plan §4.2. `bun run arch` (dependency-cruiser) fails on any import that breaks them.

| Layer            | Holds                                                                           | May import                                |
| ---------------- | ------------------------------------------------------------------------------- | ----------------------------------------- |
| `src/shared/`    | Types, errors, the event union, the seams (clock, process runner, logger)       | Nothing of ours                           |
| `src/core/`      | Instance, vault sync, projects, sessions, skill runs, approvals, schedules      | `shared`                                  |
| `src/engines/*/` | One adapter per engine (`claude-code/`, `pi/`), each implements the engine port | `shared` only; never another engine       |
| `src/frontends/` | `api/` (HTTP + WebSocket), `cli/`, `telegram/`, `web/`                          | `shared` and the core's public API        |
| `src/main.ts`    | Wiring only                                                                     | Everything; nothing imports `src/main.ts` |

- **A front end never names an engine.** It talks to the core, and the core talks to the engine port.
- **One core process per instance** owns the vault and serves the local API. The CLI and the web UI are clients of that API (ADR 0004).
- `scripts/` holds development scripts. They sit outside the layers, the coverage, and the mutation run.

## Standards

`docs/standards/README.md` indexes the written patterns: error handling, events, file layout, naming, and tests. Follow them in new code. A reviewer checks a PR against them.

## Rules

- **Never write personal data into any file, commit, issue, or PR.** This repository is public (plan §2.1): no vault content, no names of private people, no employer names, no machine addresses, no tokens, no absolute home paths. Use the neutral demo vault and `example-app` style names in tests and docs.
- **Fake only at the named seams** (clock, process runner, git, engine, Telegram Bot API, MCP). Never mock an internal module. Details: `docs/standards/tests.md`.
- **Each `[keep]` or `[adapt]` lesson in `docs/lessons-from-v1.md` that your change touches needs a test**, or a comment in the code that says why no test is possible (plan §10).
- **Never detect engine output by its English wording** when a structured field exists (lesson 36).
- **Give every child process an explicit environment allowlist** (lesson 96). Use `buildChildEnvironment` in `src/shared/environment.ts`; never pass `process.env` through.
- **Redact before you log or emit.** Every log record and every event goes through the `Redactor` in `src/shared/redaction.ts` (lesson 95).
- **Write state files atomically, and never crash on a bad file** (lesson 54). Use `writeFileAtomic` and `readJsonTolerant` in `src/shared/files.ts`.
- **Bound every wait and every child process with a timeout** (plan §6, lesson 81).
- **A step that needs the owner** (a login, a token, BotFather, Tailscale, Google Cloud, a real machine) goes into `docs/owner-todo.md` as one line. Then continue with fakes (plan §10).

## Gotchas

- **Keep `typescript` on 6.x.** `typescript-eslint` 8.x supports TypeScript `<6.1.0` only, so TypeScript 7 breaks the lint.
- **Bun reports no branch coverage, and counts every inner arrow function as a function, per file.** The floor in `bunfig.toml` is 90% lines and 80% functions, for each file: a file whose code is all tested can still show under 90% functions. A class field initializer (`private count = 0;`) counts as a function that no test calls: set fields in the constructor instead.
- **Bun reports 0% lines for a whole file when an `AbortSignal.timeout(...)` call in it never runs in a test.** Expose a base-URL seam and call the real `fetch` against a local fake server (as `src/core/checks.ts` does); never inject a default `fetch` that the tests skip.
- **Bun counts coverage only for files that a test imports.** A file with no test is invisible, not 0%. `src/main.ts` stays out this way; keep it wiring only.
- **`bun test` finds tests only under `test/`** (`root` in `bunfig.toml`). A test file in `src/` never runs.
- **The public-content check reads only tracked files** (`git ls-files`). A new file is checked only after `git add`.
- **The private denylist lives outside the repository**, at `EVA_PRIVATE_DENYLIST` or `~/.config/eva-dev/denylist.txt`. CI has no denylist, so only the local pre-push run checks it. Never copy a denylist entry into anything you write.
- **Never put content in a `CLAUDE.md`.** Each one is a one-line `@AGENTS.md` shim. Write the content in the `AGENTS.md` next to it.
- **CI runs on Windows too.** Read lessons 76 to 83 before you write code that spawns a process, builds a path, or orders events by time.
- **The release key has two halves that must match.** The private key is the `EVA_RELEASE_SIGNING_KEY` repository secret; the public key is `releasePublicKey` in `src/core/updates/release-verification.ts`. Change both together, or every `eva update` refuses the release. A `v*` tag runs `.github/workflows/release.yml`; the tag must equal the `package.json` version.
- **Bun 1.4 ignores `timeout` in `bunfig.toml`.** The test scripts pass `--timeout 30000`; a bare `bun test <file>` gives each test 5 seconds.
- **Bun gives each `beforeEach` and `afterEach` hook 5 seconds, apart from the test timeout.** A hook that runs git passes `gitHookTimeoutMs` from `test/support/git-sandbox.ts`, or it times out on a Windows CI runner.
- **The single executable refuses a `Bun.file(...)` value in `Bun.serve` `routes`**, but `bun test` from source accepts it. Use a `Response` (see `staticFile` in `src/frontends/api/local-api.ts`). After you change the served files, run `bun run build:executable` and start `dist/eva` once.
- **Git tests must clear the `GIT_*` variables** that a git hook exports, or they write the real index (lesson 104).

## Test-Driven Development (mandatory)

Develop new behavior **test-first, red-green**: write a failing test that pins the behavior you want (**red**), make it pass with the smallest change (**green**), then clean up with the test as your safety net. A bug fix starts with a test that reproduces the bug. A commit that changes `src/` with no test change states the reason in its message (plan §13).

What to test, and how (`adr/0009-layered-testing-strategy.md` has the why; `docs/standards/tests.md` has the rules):

- **Core logic (`src/core/`, `src/shared/`)**: unit tests under `test/unit/<layer>/`, with fakes at the named seams only.
- **Engine adapters (`src/engines/`)**: parser tests on output captured from a neutral demo vault, and contract tests on the exact argument list or SDK options (lessons 101, 102).
- **Front ends**: the CLI and the API against a fake engine; Telegram against a fake Bot API server (P4); the web UI with Playwright (P5).
- **End-to-end**: the core with local bare git remotes and a fake engine.
- **Exempt**: `src/main.ts`, because it only wires the layers. Keep it free of decisions. A real login run (`bun run smoke:live`, with `CLAUDE_CODE_OAUTH_TOKEN` set) covers the real engine. Without a token it skips, and `docs/owner-todo.md` keeps the run on the list.

The gate: CI runs `bun run check` on every PR, on Ubuntu and on Windows. No ruleset blocks a merge, so you hold the gate yourself (see Git Workflow).

## Git Workflow

- Branch from `main`, PR back to `main`. Whenever you create a branch, use the `create-branch` skill.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, `build:`. Whenever you commit, use the `write-commit` skill.
- CI (`.github/workflows/pull-request-checks.yml`) runs the `checks` job on `ubuntu-latest` and `windows-latest`, and the `secrets` job (gitleaks), on every PR and on `main`. Lefthook runs the format check and lint before each commit, and `bun run check` before each push.
- **No merge ruleset protects `main`** (owner decision, 2026-10-14). An agent may merge its own PR only when every check is green on both Ubuntu and Windows. **Never merge on red, pending, or missing checks.**
- **Merge a PR only when its branch contains the latest `main`.** Two PRs that are each green can break `main` together (2026-10-17: a changed function signature in one, a new caller in the other). Merge `main` into the branch, wait for green, then merge with `gh pr merge --match-head-commit`.
- **Never push to a person's vault** outside phase P1.

## Documentation Organization

Each kind of knowledge has one home. Write a change in the home that matches it; never duplicate the same content across homes. What decides the home is **when the file loads** and **how deep it goes**, not its subject.

| Home                             | Loaded                           | Holds                                                                                                                                                                                                   |
| -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                      | Every session                    | The map: architecture facts, conventions, gotchas, and the ADR index. Points to the homes below; does not repeat their depth. (`CLAUDE.md` is a one-line `@AGENTS.md` shim.)                            |
| `docs/standards/*.md`            | On demand, when you write code   | One code pattern per file, as rules a reviewer can check.                                                                                                                                               |
| `docs/plan.md`                   | On demand, per area              | The approved design: what Eva does and why. The other `docs/` files feed it: `intent.md`, `lessons-from-v1.md`, `review-2026-10-14.md`, `spikes.md`. `owner-todo.md` lists steps only the owner can do. |
| `.claude/skills/<name>/SKILL.md` | On demand, when the task matches | One procedure: how to do X.                                                                                                                                                                             |
| `adr/NNNN-*.md`                  | On demand, via adr-checker       | One architectural decision and its why.                                                                                                                                                                 |
| `README.md`                      | Read by humans                   | What the project is, setup, run, test.                                                                                                                                                                  |

**All of these files are living: keep them true.** When you learn something that helps future agents, update the right file in the same session. When a file holds wrong or outdated information, fix it or remove it. This covers code comments too. After implementation, the **docs-checker** agent catches drift you missed.

**Rules:**

- ADRs are agent-only: never reference or list them in a `README.md`.
- Number ADRs in sequence (`NNNN-kebab-title.md`) and never renumber an existing file. Index each one as a one-line row in the ADR table below, never a summary.
- Do not duplicate content between `README.md` and `AGENTS.md`; reference it instead.
- An ADR records a decision from `docs/plan.md` and its why. When the plan and an ADR disagree, the plan wins: fix the ADR.
- `CLAUDE.md` is a one-line `@AGENTS.md` shim; edit `AGENTS.md` instead.

## Architecture Decision Records (ADRs)

ADRs live in `adr/`. Each records one architectural decision or cross-cutting standard and why. **One ADR per pattern, kept alive:** when a pattern changes, update its ADR in place; create a new ADR only for a genuinely new pattern. Most changes need no ADR. Conventions: `adr/AGENTS.md` (auto-loads through its `adr/CLAUDE.md` shim when you work in `adr/`).

**Before implementing** in an area that may carry a decision, delegate to the **adr-checker** agent in consult mode. These areas usually carry decisions: the repository split and public content, the process model and the local API, the layer rules, engine adapters and the engine port, the two modes and their engine options, vault sync, and the testing strategy.

**After implementing**, delegate to the **adr-checker** agent in maintain mode only if you introduced a new architectural pattern or changed one an ADR already records.

| ADR                                             | Topic                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `0001-agent-docs-structure.md`                  | `AGENTS.md` map + Claude-Code-only skills/subagents/settings                          |
| `0002-public-engine-private-vault.md`           | Two repositories: a public engine with no personal data, and one private vault        |
| `0003-typescript-on-bun.md`                     | TypeScript for core and UI, run with Bun                                              |
| `0004-one-core-process-with-local-api.md`       | One core process per instance; front ends are clients of a local HTTP + WebSocket API |
| `0005-layers-enforced-by-dependency-cruiser.md` | Four source layers with import rules that `bun run arch` enforces                     |
| `0006-engines-connected-directly.md`            | Claude Agent SDK and pi over RPC behind one engine port; ACP later                    |
| `0007-assistant-and-project-modes.md`           | Assistant mode is Eva's behaviour; Project mode is a transparent harness wrapper      |
| `0008-eva-owns-vault-sync.md`                   | Vault sync in Eva's code; no agent hooks in Eva or the vault                          |
| `0009-layered-testing-strategy.md`              | Unit tests with fakes at named seams, adapter contract tests, e2e with fakes, floors  |
| `0010-person-settings-in-the-vault.md`          | The person's settings in the vault's `.eva/settings.json`; the machine's in the home  |
| `0011-self-update-when-idle.md`                 | Self-update at a set frequency, installed only when idle, then a restart              |
| `0012-hub-claimed-in-the-vault.md`              | The vault's `.eva/hub.json` names the hub; no role setting; it moves without restarts |

## GitHub issues, PRs, and other artifacts

- **Always self-assign PRs** when you create them.
- **Always link PRs to issues** with `Closes #N` in the PR body, so the issue auto-closes on merge.
- **Always add the `waiting-for-human-check` label** when you create a GitHub issue, PR, or any other reviewable artifact. It means no human has verified the content yet; a human removes it after reviewing. The label marks state (unreviewed), not origin.
- **Never put personal data in an issue or PR.** The repository is public.

If the repo has no `waiting-for-human-check` label, create it first:

```bash
gh label create "waiting-for-human-check" --description "No human has verified this yet -- direct AI output" --color "D93F0B"
```

Whenever you create a GitHub issue, use the `create-issue` skill. Whenever you implement one, use the `implement-issue` skill. Whenever you review a PR, use the `review-pr` skill.

## Coding standards

- **Match existing patterns.** Before writing code, find similar implementations and follow their style, structure, and conventions (the **pattern-scout** agent does this).
- **Explicit type annotations** are mandatory for all parameters, return types, and non-trivial variables. No `any`. ESLint enforces explicit return types.
- **Comment the _why_, never the _what_.** A comment must carry what the code cannot: a non-obvious constraint, an intentional divergence, a trap a future reader would reintroduce. Cite the plan section or the lesson number when one applies. Do not document self-explanatory names or signatures, and match the comment density of the surrounding file.

## Refactoring safety

Whenever you rename or refactor a symbol, use the `rename-symbol` skill.

## Debugging

Whenever a fix attempt fails or a bug needs root-causing, use the `debug` skill.

## Writing prompts for agents and rules

Whenever you author or edit an AI-facing file (`AGENTS.md`, skills under `.claude/skills/`, subagents under `.claude/agents/`, prompts for agents you spawn), use the `write-ai-instructions` skill.

## Self-updating rules

These instruction files are living, and keeping them current is part of the work. Persist a rule right away (in the narrowest scope that fits) instead of applying it only this session when you discover something **extremely hard to find, deeply non-obvious, and time-saving for future sessions**, hit a pattern that **diverges from what an AI would write by default**, when the user says **"every time" / "always" / "never"**, or when **feedback on your own work reveals a standard you should have followed** (a PR review comment, a user correction). Persist it in these shared, committed files, never in personal memory or the global config, so the whole team gets the lesson. For where to write it, use the `write-ai-instructions` skill.
