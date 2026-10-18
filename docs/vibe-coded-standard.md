# The vibe-coded project standard

This document describes how a repository must look so that coding agents can develop it on their own.
Eva follows it and is the reference repository. Eva's repository setup report checks other repositories against it.

## Principles

- **Any coding tool works.** A required file or check never depends on one harness (Claude Code, Codex, Cursor, pi). A harness-specific file is an optional extra.
- **Short and clear documentation.** A person new to the project, or an agent, understands each file on the first read.
- **Guards live on the server.** GitHub enforces the merge gate, the token rights and the secret scan. No agent can skip them.
- **Agents work alone.** A person steps in only where a label asks for it.

## Structure

| Path                             | Content                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `AGENTS.md`                      | The map for agents: goals that must not change, rules, architecture, gotchas. |
| `<module>/AGENTS.md`             | The context of one module, when the module has its own rules.                 |
| `README.md`                      | For people: what the project is, how to install and run it.                   |
| `.agents/skills/<name>/SKILL.md` | The workflows. See [Skills](#skills).                                         |
| `SECURITY.md`                    | How to report a vulnerability in private.                                     |
| `lefthook.yml`                   | The git hooks.                                                                |
| `.github/workflows/`             | The CI checks on each pull request.                                           |

- **No `CLAUDE.md` anywhere.** A `CLAUDE.md` in a folder or a parent folder stops Claude Code from reading `AGENTS.md`. A pre-commit hook and a CI test refuse a `CLAUDE.md`.
- **Organize the code by modules.** A module holds one concern. An architecture check enforces the allowed imports between modules.

## Documentation

- Keep each file as short as possible, without loss of a needed fact.
- Write for a reader who does not know the project or its tools. Explain each term on first use.
- Give each fact one home. A rule that a check enforces, or a fact that the code shows, gets no line.
- Follow the writing style in Eva's `AGENTS.md`: Zinsser for all prose, ASD-STE100 for technical text.
- When an agent learns a hard-won trap, it adds one line to the nearest `AGENTS.md`.

## Skills

- A skill is a workflow for a task that repeats: write a commit, rename a symbol, create an issue, implement an issue.
- A skill is not a template and not a code of behavior. Behavior rules go in `AGENTS.md`.
- A skill states the goal and the steps that an agent can get wrong. It does not list commands that an agent already knows.
- Skills live in `.agents/skills/`. The dependency install and the git hooks copy them to the git-ignored `.claude/skills/`, because Claude Code finds skills only there.

## Tests

Work red-green: write a failing test first, then the smallest code that passes it. A bug fix starts with a test that reproduces the bug.

## Checks

- **One umbrella script** (for example `check`) runs every check. CI runs it, and a developer can run it by hand.
- **The script runs:** format, lint, types, architecture, dead code, tests with coverage, and commit messages. A secret scan runs in the script or in its own CI job.
- **A check that matters runs in CI.** A git hook only gives early feedback: a cloud agent commits with no git hooks.

### Fast checks (recommended)

The minimum is CI with tests and red-green TDD. A fast check loop is better: agents wait less, and fewer slow runs fail by chance.

- **Run each check where it can fail.** A check that reads only source files runs on one operating system. The tests run on each supported system.
- **Skip work that a change cannot affect.** A docs-only PR skips the code jobs. Any doubt runs the full set.
- **Put the skip on the steps, not on the job.** A skipped job can leave a required check without a result.
- **Share costly test setup.** Build a fixture once per test run, and give each test its own copy.
- **Keep tests independent.** Run the suite in random order to find tests that depend on each other.
- **Cache what does not change,** such as a downloaded model or a built tool.
- **Cancel an old CI run** when a new commit arrives on the same branch.

## Environment variables

When the project uses environment variables:

- `.env` holds public defaults. `.env.local` holds secrets and machine values, and git ignores it.
- `.env.example` lists each variable with a short explanation.
- One config module reads the variables. No other code reads them.

## Git hooks

Lefthook installs the hooks with the dependency install. The hooks are harness-agnostic, so they replace agent hooks. A cloud agent runs no git hooks, so CI repeats each hook check.

| Hook                      | Work                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| pre-commit                | Format and lint the staged files. Refuse a `CLAUDE.md`.                                                                                     |
| pre-push                  | Run every check but the tests, with the parts that exist only on the local machine, such as a private denylist. CI runs the tests.          |
| post-merge, post-checkout | Install the dependencies when the lockfile changed. Run the code generation when its sources changed. Copy the skills to `.claude/skills/`. |

## Pull requests and merge

- **A ruleset named "Requirements for merge"** on the default branch: every CI check passes, the branch is up to date, no deletion, no force-push.
- **Repository settings:** auto-merge on, the update-branch button on, and head branches deleted after merge.
- **Squash merge off.** A squash merge loses the commit prefixes that pick the version.
- **The repository admin can bypass the ruleset for pull requests only.** Direct pushes to the default branch still follow the rules.
- **A large change starts with a plan** in `docs/plans/<name>.md`, pushed to a draft PR. Delete the plan before the merge: the branch history keeps it.
- **An agent merges its own PR** with auto-merge. GitHub merges it when the checks pass.
- **When the PR does not merge, the agent finds the cause and fixes it:** it updates a branch that is behind, resolves a conflict, or fixes a red check.
- **An agent never bypasses the ruleset.** A deny or ask rule stops each merge with admin rights, such as `gh pr merge --admin` or a GitHub merge tool.

## Releases

- **Each merge to the default branch that changes the shipped code makes a release,** after the checks pass there.
- **The commit prefixes pick the version** (`MAJOR.MINOR.PATCH`): `feat:` raises `MINOR`, `fix:` raises `PATCH`, and a `!` raises `MAJOR`.
- **A check refuses a commit subject without a known prefix.**
- **`AGENTS.md` defines a breaking change for the project.** In general, a change is breaking when the user must act by hand after the update, or loses something.
- **A check enforces the `!`.** When a stored or public name goes away with no migration and no `!`, CI fails. An agent can forget a rule, but not a check.
- **A stored format changes through a migration.** Each migration has a dated id, runs once at start, and is recorded as applied. A format change with a migration is not breaking.
- **The user chooses which releases install by themselves:** only fixes, fixes and features, or all.
- **Before a manual update, the user sees what each release brings.**

## Labels

Delete GitHub's default labels. Keep these three:

| Label                         | Meaning                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `auto-developing`             | An agent works on it now.                                               |
| `waiting-for-human-check`     | An agent made it, and no person checked it yet.                         |
| `requires-human-intervention` | Only a person can do the next step, such as a login or a hardware test. |

An agent that picks the next issue by itself skips each issue with one of these labels.

## Issues

- **The title starts with the type:** `Bug:`, `Feature:`, `Improvement:` or `Task:`. For example: `Bug: the web view loses the chat after a reload`.
- **The body starts with a one-line summary.** Then the context and the acceptance criteria, as behavior that a person can see.
- **A proposed solution** appears only when the reporter proposed one.

## Agent permissions

- Agents run the usual work with no permission prompt: build, test, commit, push to a branch, open and merge a PR.
- Deny rules block the dangerous forms: force-push, history rewrites, skipped hooks, reads of secret files.
- An ask rule covers only a merge that bypasses the ruleset.
- A permission file is harness-specific, such as `.claude/settings.json` for Claude Code.
- Deny rules catch mistakes, not a hostile agent. The ruleset and the sandbox are the real guards.

## Security

| Item                                     | Public repository                          | Private repository                          |
| ---------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| `SECURITY.md`                            | Points to private vulnerability reporting. | Says to contact the maintainers in private. |
| Private vulnerability reporting          | On                                         | Not available                               |
| Dependabot alerts                        | On                                         | On                                          |
| Dependabot malware alerts                | On                                         | On                                          |
| Dependabot security updates              | On                                         | On                                          |
| CodeQL default setup                     | On                                         | Needs GitHub Advanced Security              |
| Secret scanning and push protection      | On                                         | Needs GitHub Advanced Security              |
| CI token                                 | Read-only by default                       | Read-only by default                        |
| Secret scan in CI (for example gitleaks) | On                                         | On                                          |
