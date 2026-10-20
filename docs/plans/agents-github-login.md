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

(Filled in after the gap research.)
