# Plan: give each extra instance its own engine folders (issue #10)

This file is a working plan. The last commit of the PR deletes it; the PR description keeps the record.

## Goal

An instance is extra when its home folder is not the platform default.
Each extra instance keeps its Claude, pi and gh logins in `<home>/engines/`.
`eva setup` explains this and walks through each engine login for that instance.
The person's subscription is never used by another person (lesson 111).

## Today

- `engineEnvironment` in `src/core/eva.ts` sets `CLAUDE_CONFIG_DIR` and `GH_CONFIG_DIR` for an extra instance.
- pi's agent folder is left out: the comment says pi has no documented variable.
- pi 0.73.1 documents `PI_CODING_AGENT_DIR` (README, "Environment variables"; `docs/usage.md`). Default: `~/.pi/agent`. It holds `auth.json` (the login), `settings.json` and `models.json`.
- `eva setup` says nothing about engine logins for an extra instance.

## Steps

1. **One home for the engine folders.** Add a core function that returns the engine config folders of an instance as environment variables (`CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, `GH_CONFIG_DIR`), plus the extra-instance test. `engineEnvironment` and `eva setup` both use it.
2. **pi's agent folder.** Set `PI_CODING_AGENT_DIR` for an extra instance. Red test first in `eva.test.ts`.
3. **Eva's own gh calls.** Eva runs `gh` herself (setup `gh repo create`, the settings page GitHub check, `gh pr view` for the project view). For an extra instance these use the instance's gh folder too. (Gap G3.)
4. **`eva setup` walk-through.** For an extra instance, setup explains why the instance has its own engine folders, then gives the exact login step for each engine: Claude (`claude setup-token`, whose token setup then asks for), pi (`pi`, then `/login`, never with a Claude login), gh (`gh auth login`). Each step names the variable and folder, in the shell syntax of the platform. (Gaps G2, G4.)
5. **Docs.** Update `docs/guide/setup.md` (and `reference.md` if it lists the folders). Drop the stale comment in `eva.ts`.

## Gaps

- **G1.** Where does pi's agent folder live? `engines/pi` is already Eva's own pi folder (sessions, prompts, extension).
- **G2.** How does setup "walk through" a login? `ProcessRunner` captures output, so an interactive login cannot run through the seam.
- **G3.** Should Eva's own `gh` calls use the instance's gh folder?
- **G4.** How does setup know the instance is extra?
- **G5.** Does the default home need anything for pi (like `ownConfigFolder` for Claude)?

## Decisions

Three reviewers (two mid-tier, one upper-tier) agreed on each gap. None needs the owner.

- **G1.** pi's agent folder is `engines/pi-agent`, a sibling of `engines/pi`. pi reads `<agentDir>/prompts/*.md` as prompt templates, and Eva writes a per-session prompt to `engines/pi/prompts/`. One folder would turn each of those into a slash command, and would mix pi's `auth.json` with Eva's files.
- **G2.** Setup prints the steps and never runs an interactive login. `ProcessRunner` captures output, and a new seam with inherited input and output would break `--non-interactive`. Setup already works this way (`claude setup-token`, `gh auth login`). The steps show at the start of setup, before `gh repo create` can run. Each command uses the platform's shell: POSIX on Linux, PowerShell on Windows. At the end, setup checks each login through the seam (`gh auth status`) or the files (`auth.json` for pi, the saved token for Claude) and reports what is missing. The Claude step warns that the browser may be signed in to another person's account.
- **G3.** Yes. Eva's own `gh` calls (setup's `gh repo create`, the settings-page check, `gh pr view` in the project view) get the instance's folder variables. Without them, an extra instance uses another person's gh login. `EVA_GITHUB_TOKEN` feeds only git's credential helper, so it does not cover `gh`.
- **G4.** Move the extra-instance test (`resolve(defaultHome) !== resolve(root)`) next to `HomePaths` in `src/core/settings/home.ts`. `main.ts` passes `defaultHomeFolder()` to setup, as it already does to `Eva`.
- **G5.** Nothing. The first instance keeps the OS user's own folders, so Project mode matches a manual session. `ownConfigFolder` stays a Claude-only opt-in.

Out of scope: the environment allowlist drops a `CLAUDE_CONFIG_DIR`, `GH_CONFIG_DIR` or `PI_CODING_AGENT_DIR` that the person sets in their own shell. That is a separate follow-up.
