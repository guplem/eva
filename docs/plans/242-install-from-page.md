# Install Claude Code, pi and uv from the web page (#242)

## Why

A person on a phone cannot run `eva setup`. The page tells them to when no `claude`, `pi` or `uv` program exists. `AGENTS.md` says that a fix that needs a terminal is a gap to close.

## What exists

- `Eva.installTool(program)` installs `claude`, `pi`, `uv` or `gh`, and `POST /api/tools/install` serves it. The Versions card uses it.
- The engine ports and the Claude login get the program path at start (`src/main.ts`). A program that the page installs later is unknown to them until a restart.

## Gaps and decisions

1. **How does the engine step move to the login after an install, with no restart?**
   Eva keeps the path of each engine program that she installed since the start. The setup progress, the page's engine list and the Claude login use it. A chat still needs a restart, and the login already says so.
2. **What does "found" mean for the chat blocker?**
   The running state counts only the engines of the start. A newly installed engine with a login then gives the `restart` blocker, not "ready".
3. **How does the page know that uv is missing?**
   The setup state gets `uvMissing`. Eva asks `uvx --version` in a chat's environment only when a Google account is set, as the Google check does. A uv that Eva installed since the start counts as there.
4. **Which component shows the button?**
   One shared `ToolInstallButton` in the web client. The Claude Code card (also the body of the "An AI engine" step), the pi card and the Google card use it.
5. **What text replaces "Run `eva setup`"?**
   The progress step, the Claude login error and the Google check point to the Install button in Settings on Eva's page. A failed install keeps the steps by hand that `installTool` gives, plus "Press Install to try again".
6. **Restart.** An install of `claude`, `pi` or `uv` sets `restartNeeded`, so the page shows its restart callout.
