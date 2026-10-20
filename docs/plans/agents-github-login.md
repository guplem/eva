# Plan: one GitHub login for Eva and her agents

Issue: #244.

## Why

The agents push, open pull requests and use issues with the instance's own `gh` login.
Only `gh auth login` in a terminal sets it up, and the web page never mentions it.
A person who sets Eva up from the web page alone gets agents that cannot deliver their work.
This breaks the goal "Eva works from a phone".

## Owner decision

One login for everything (asked in the session, 2026-10-20).
The GitHub browser login of the page and of `eva setup` also logs in the agents' `gh`.
The login text stops promising that the agents never get the token, and says what they do with it.

## Changes

- The device flow asks for the scopes that `gh` needs: `repo`, `read:org` and `gist`, and `workflow`, so that an agent can push a change to a workflow file.
- When Eva saves a GitHub token, she also logs in the instance's `gh` with it: `gh auth login --with-token --insecure-storage`, with the instance's `GH_CONFIG_DIR`.
- The page shows whether the agents' `gh` is logged in, on the GitHub card.
- The login text, the guide and the code comments say that the agents use the login too.

## Gaps

- G1. Which saves log in `gh`: the browser login only, or a pasted token too? A fine-grained token has no scopes, and a classic one may lack `read:org`.
- G2. What happens to a `gh` login that the person made by hand, maybe with another account? Replace it, or keep it?
- G3. A token from before this change has only `repo`. How does the person get the new scopes?
- G4. Does removing the token also log out `gh`?
- G5. Where the `gh` login runs: in `Eva.saveSecret` (the page), and in `eva setup` (the CLI saves the secret without an `Eva`). The seam, the timeout, the environment, and how a failure reaches the person.
- G6. What the page shows: the state of `gh`, and the words. Where the state comes from (the setup state, or the GitHub check).

## Decisions

- G1. Every save of the GitHub token logs in `gh`: the browser login and a pasted token. `gh` accepts a fine-grained token (it has no scopes to check). It refuses a classic token without `read:org`. A `gh` failure never blocks the save: the vault works with the token alone.
- G2. Replace. `gh auth login --with-token` makes the new account the active one in the instance's own `gh` folder (lesson 111). Eva never changes `gh` at start, so a hand-made login stays until the person saves a token.
- G3. No migration: a migration cannot add scopes to a stored token. The GitHub step shows "missing" while the token is saved but `gh` is not logged in, and says to press Log in with GitHub again.
- G4. Removing the token also logs out the instance's `gh` (`gh auth logout --hostname github.com --user <login>`, the login read from `hosts.yml`). The guide says that a logout does not revoke the token on GitHub.
- G5. A new core module, `src/core/vault/github-cli-login.ts`, runs `gh` through `ProcessRunner`: the token on stdin, `GH_CONFIG_DIR` set to the instance's `gh` folder, `GIT_TERMINAL_PROMPT=0` and `GH_PROMPT_DISABLED=1`, a 30-second timeout, and an environment from `buildChildEnvironment` without the token. It returns a problem text and never throws.
  - `Eva.saveSecret` calls it after the save, and logs a warning on a problem.
  - `eva setup` calls it after it saves the token, and prints one line.
  - Tests never run a real `gh`: each test that saves a token gets a runner that fakes `gh`, and so does the e2e demo server.
- G6. The state comes from a file read, not from a process, because the page reads the setup state often.
  - `githubCliLoggedIn(ghFolder)` in `src/core/setup/logins.ts` reads `hosts.yml` tolerantly: a `github.com` entry with a `user`.
  - The GitHub step: no token is "optional". A token and a `gh` login is "done". A token without a `gh` login is "missing".
  - The GitHub Test also runs `gh auth status --hostname github.com`.
  - The card's pill follows the step, as the Claude Code card does.
- Scopes: `repo read:org gist workflow`. `workflow` lets an agent push a change to a workflow file.
- Words: the login text, the card, the guide and the lesson 96 comments say that the agents use the login too. `eva setup` keeps its hand step for `gh` as a fallback.
