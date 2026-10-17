# Plan: give each extra instance its own engine folders (issue #10)

This file is a working plan. The last commit of the PR deletes it; the PR body keeps the final plan.

## Goal

An extra instance is one whose home folder is not the platform default. It must keep its Claude, pi and gh logins in its own `engines/` folder, so two people on one OS user never share a login (lesson 111, `AGENTS.md` "Each person uses their own engine login").
`eva setup` must explain this and walk through each engine login for that instance.

## State today

- `engineEnvironment` in `src/core/eva.ts` sets `CLAUDE_CONFIG_DIR` and `GH_CONFIG_DIR` for an extra instance (PR #28).
- pi's folder is left out: the comment says pi has no documented variable.
- `eva setup` says nothing about engine logins of an extra instance.

## Facts found

- pi 0.73.1 (the version that the fixtures use) documents `PI_CODING_AGENT_DIR` in its README: "Override config directory (default: `~/.pi/agent`)". pi keeps `auth.json`, `settings.json` and `models.json` there.
- Eva already passes `--session-dir`, so pi's default session folder inside the agent folder is unused.
- `src/main.ts` gives `PiEngine` the work folder `engines/pi` (sessions, extension file, prompt file).

## Steps

1. Move the "which engine folders does this instance own" decision into one core function, so the core and `eva setup` share one source of truth. Red-green: unit tests for the function.
2. Add `PI_CODING_AGENT_DIR` for an extra instance. Red-green: extend the extra-instance test in `test/unit/core/eva.test.ts`.
3. `eva setup` on an extra instance: explain that this instance has its own engine logins, and walk through the Claude, pi and gh login for that instance. `main.ts` passes the default home into setup. Red-green: tests in `test/unit/frontends/cli/cli.test.ts`.
4. Update `docs/guide/setup.md` ("A second person on the same computer") and the stale comment in `eva.ts`.
5. Delete this plan file.

## Gaps

- G1. Where pi's agent folder lives: `engines/pi` (Eva's pi work folder), `engines/pi/agent`, or `engines/pi-agent`.
- G2. How setup "walks through" each login: print the exact commands, run the login programs itself, or check the login state afterwards.
- G3. Whether the default home should also get its own pi folder through a setting, as `engines.claudeCode.ownConfigFolder` does for Claude.

## Decisions

(Filled in after the gap review.)
