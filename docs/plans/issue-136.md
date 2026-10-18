# Plan: eva setup installs the chosen harness (#136)

Delete this file before the merge. The decisions then live in the commits and in the pull request.

## Goal

`eva setup` installs the harness of the default engine when it is missing, as it does for Tailscale. A new person reads no install page for Claude Code or pi before setup.

## Design

1. **A core module, `src/core/engine-install/engine-install.ts`,** beside `tailscale-install.ts`. It finds an engine's program, installs it, and gives the exact steps when it cannot. It runs every command through the `ProcessRunner` seam, with a timeout.
2. **Find a program by running `<program> --version`,** as the doctor does. For Claude Code, also try the folder of the official installer, `~/.local/bin/claude` (`claude.exe` on Windows). A fresh install is often not on the `PATH` of the running terminal.
3. **Install Claude Code with its official installer.** Linux and macOS: `bash -c "curl -fsSL https://claude.ai/install.sh | bash"`. Windows: `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"`. Neither needs an administrator.
4. **Install pi with npm:** `npm install -g @mariozechner/pi-coding-agent`. On Windows, npm and pi are `.cmd` files, so Eva runs them through `cmd /d /c`. Without npm, Eva installs nothing and gives the steps: install Node.js from nodejs.org, then run the npm command.
5. **Setup asks after the engine question.** A new question, `installEngine` (`EVA_INSTALL_ENGINE`): "Claude Code is not installed. Install it now? [Y/n]". Enter means yes. So `--non-interactive` setup installs too, and a script can answer `no`.
6. **A failed install:** a person sees the steps, and setup goes on. A script stops with EvaError `engine_install_failed`, whose message holds the steps.
7. **After the Claude Code install,** setup says where the program is, and that `claude setup-token` makes the token for the next question.
8. **`src/main.ts` also looks in `~/.local/bin`** for `claude`. A service whose `PATH` lacks that folder still finds a fresh install.
9. **Docs:** the README and `docs/guide/setup.md` stop asking for a harness install before setup. They keep the commands for a person who wants to install by hand.

## Tests

- Unit tests for the module with a scripted runner: found on the `PATH`, found only in `~/.local/bin`, missing; the install command per platform; pi without npm gives the steps; a failed installer gives the steps.
- `runSetup` tests: a missing Claude Code is offered and installed, then the Claude token question comes; `n` installs nothing; an installed harness asks nothing; a non-interactive setup installs, or stops with `engine_install_failed`.

## Gaps

- **Where Claude Code lands, and the service `PATH`:** decision 2 and 8.
- **A question for `--non-interactive`:** decision 5.
- **pi without Node.js:** steps only (decision 4). Eva does not install Node.js.
- **macOS:** the same as Linux. Eva does not test it, but the installer supports it.
