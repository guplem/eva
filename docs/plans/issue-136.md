# Plan: eva setup installs both harnesses (#136)

Delete this file before the merge. The decisions then live in the commits and in the pull request.

## Goal

`eva setup` installs Claude Code and pi when they are missing, with no question. Setup asks no "Default engine" question. The person gives only the login of the harness that they use.

The owner changed the scope after the first plan: both harnesses, no engine question (see the comments on #139).

## Design

1. **A core module, `src/core/engine-install/engine-install.ts`,** beside `tailscale-install.ts`. It finds an engine's program, installs it, and gives the exact steps when it cannot. Every command goes through the `ProcessRunner` seam, with a timeout.
2. **One list of places for each program,** `engineProgramCandidates`. `src/main.ts`, setup and the doctor all use it, so a fresh install is found even when the `PATH` of a terminal or a service lacks its folder.
   - Claude Code: `claude`, then `~/.local/bin/claude` (`claude.exe` on Windows), where its installer puts it.
   - pi: `pi`, then Eva's own install (below), then `~/.pi/agent/bin/pi`, where the pi.dev installer puts its launcher.
3. **Claude Code: the official installer,** which needs no administrator. Linux and macOS: `bash -c "curl -fsSL https://claude.ai/install.sh | bash"`. Windows: `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"`.
4. **pi: the standalone build from its GitHub release.** The release has one archive per system (`pi-linux-x64.tar.gz`, `pi-windows-x64.zip`, and so on), made with `bun build --compile`. It needs no Node.js and no npm, which the Eva executable does not have. Eva downloads the archive, checks it against the release's `SHA256SUMS`, and extracts it with `tar`, as she does for Tailscale.
   - Linux and macOS: into `~/.local/lib/pi/`, with a link at `~/.local/bin/pi` for the person's own terminal.
   - Windows: into `%LOCALAPPDATA%\Programs\pi\`.
   - Rejected: npm (the executable has no npm, and a system Node needs root), the pi.dev installer (it needs Node.js and asks questions on the terminal), and `BUN_BE_BUN=1` (pi's npm launcher still starts Node.js).
5. **Setup installs both before the Claude token question,** with no question. A harness that is already there stays as it is.
6. **A failed install never stops setup,** in a script too. Setup says what failed and the exact steps. `eva doctor` shows the missing program, with the hint "run `eva setup`".
7. **No "Default engine" question.** A script can still set `EVA_ENGINE`. Without it, setup changes the default only when the default harness has no login and the other one has one. So Claude Code stays the default when both have a login, and a choice that the person made on the web page stays.
   - A Claude login: a saved Claude token.
   - A pi login: a provider in pi's `auth.json` other than Anthropic.
8. **The installers get the person's proxy variables** (`HTTPS_PROXY`, `NO_PROXY`, and so on), and never an instance's engine folders. The program belongs to the OS user. Each instance keeps only its own login.
9. **Docs:** the README and `docs/guide/setup.md` stop asking the person to install or to choose a harness.

## Tests

- Module: the places to look; the Claude Code installer per system; the pi download, its checksum, a bad checksum, an unknown system; each failure gives the steps.
- Setup: neither harness installs both with no question; an installed harness installs nothing; a failed install lets setup go on with the steps, in a script too; no engine question; `EVA_ENGINE` still works; the default follows the login.

## Out of scope

- An install from the phone. Setup runs in a terminal. A missing engine shows in `eva doctor` and in the log, as today.
- The pi login in the terminal and on the web page: #137.
