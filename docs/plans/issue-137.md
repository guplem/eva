# Plan: finish the setup on the web page, with a progress list (#137)

Delete this file before the merge. The decisions then live in the commits and in the pull request.

## Goal

Over SSH, a person runs `eva setup`, answers only what the terminal truly needs, and finishes on the web page. The page shows a progress list until every step is done. The terminal can still do the whole setup, with questions or with `--non-interactive`. Telegram is optional.

## Facts from the code

- Eva runs with no vault and no Telegram bot (`src/main.ts`, `src/core/eva.ts`).
- `src/core/checks.ts` holds the checks behind the **Test** buttons: `vault`, `claude-code`, `pi`, `github`, `telegram`, `google`. The `claude-code` and `pi` checks make a real model call.
- `src/core/remote-access/device-logins.ts` takes several approvers. Telegram is the only one. With no approver, a device login fails with `device_login_unavailable`, and only the long `localApiToken` login works.
- A device login cannot save a token (`LiveSettings.saveSecret` with `pageOnly`), and cannot use `/api/google/*` or `/api/remote-access/*`.
- The running Eva does not watch `config.json` or `secrets.json`. A change from another process needs a restart. The page's own token saves already say "restart needed".
- `eva setup` keeps most answers in memory and saves them at the end.
- `eva setup` does not start the service. `eva service install` does.

## Design (first draft)

1. **The short terminal path comes first.** Setup installs the engines (#136) and Tailscale, starts Eva, prints the page address, and lets the terminal allow the first device. Then it goes on with the other questions. Ctrl+C at any point loses nothing.
2. **Each answer is saved at once.** Setup re-reads `config.json` and `secrets.json` before each question and each save. A step already done on the page is not asked again, and a save never undoes a page change.
3. **The terminal allows a device.** A new approver in the core: the shell. A pending device login waits for `eva devices allow <code>`, which talks to the running Eva through the local API with `localApiToken`. During `eva setup`, the terminal asks for the code that the page shows. Only a person with a shell as Eva's user can read `localApiToken`, so only that person can allow a device. The code expiry and the rate limit stay.
4. **A progress list on the page.** The core builds it from the existing checks' inputs and the Tailscale state, never from a second list of steps. Each step shows done or missing, with what to do. A **Test** button runs the existing check. The core keeps the last result of each check, so "tested" shows too. The main page shows a short banner while the setup is not complete.
5. **Telegram is optional.** The progress list marks it as optional. `eva status` counts no missing bot or pairing as a problem.
6. **pi login.** pi's `/login` is interactive. The page and the terminal print the exact steps; the page does not run the login.
7. **Docs:** the README and `docs/guide/setup.md` describe the short path first. Rewrite "What setup asks".

## Gaps

- **G1. How the terminal allows a device** while the running Eva is another process: a shell approver plus `eva devices allow <code>` through the local API, and a code prompt inside `eva setup`?
- **G2. Does `eva setup` start Eva?** The page needs a running Eva. Options: setup offers to run `eva service install`; or setup starts nothing and says to run it.
- **G3. Which terminal questions stay "strictly needed"?** Probably none of the old questions: the vault, the tokens, Telegram and Google can all move to the page. Time zone has a default.
- **G4. What a device login may do.** Today it cannot save a token, so a device allowed from the terminal cannot paste the Claude token on the page. Should a device that the terminal allowed get the rights of a token login?
- **G5. How the running Eva picks up a change from setup:** a restart through the local API, or a reload?
- **G6. What "tested" means, and where the last check result lives.** A model call per engine is slow, so the list cannot run every check on each load.
- **G7. The pi login on a computer with no browser.**
- **G8. One pull request or several.** The change is large.
