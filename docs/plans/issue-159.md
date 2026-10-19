# Plan: one command installs Eva (issue 159)

## Goal

A new person installs Eva with one command: `curl -fsSL https://github.com/guplem/eva/releases/latest/download/install.sh | sh` on Linux, `irm https://github.com/guplem/eva/releases/latest/download/install.ps1 | iex` on Windows.

## Steps

1. `eva setup` installs uv when it is missing, in the same step as the harnesses (`src/core/engine-install/engine-install.ts`, `installEngines` in `src/frontends/cli/setup.ts`). Official installer, no administrator, the exact steps when it fails.
2. `install/install.sh` (POSIX sh): install git with apt-get, dnf, pacman or zypper when it is missing (with `sudo` unless root); download `eva-linux-x64` or `eva-linux-arm64`; check it against `SHA256SUMS`; put it in `~/.local/bin`; add that folder to `~/.profile` when the `PATH` lacks it; run `eva setup` with the terminal as input.
3. `install/install.ps1` (Windows PowerShell 5.1 and later): the same, with winget for git and `%LOCALAPPDATA%\Programs\Eva`.
4. CI: the `package` job runs each script against the executable that it built, served by a local web server. On Linux, a clean Ubuntu container with no git checks the git install too.
5. The release workflow publishes both scripts as release files.
6. Docs: README _Get started_, `docs/guide/setup.md` install sections, `AGENTS.md` folder list.

## Decisions

- **Where the scripts live:** release files, so the script and the executable come from the same checked release. The source stays in `install/`.
- **macOS:** out of scope; releases build no macOS executable. The script says so and stops.
- **Input for setup:** `curl | sh` gives the script itself as the input, so the script runs `eva setup < /dev/tty`. With no terminal, it prints the command instead.
- **Test hooks:** `EVA_INSTALL_BASE_URL` points the download at another place, and `EVA_INSTALL_SKIP_SETUP=1` skips `eva setup`. CI uses both. No other test-only path.
- **Checksums only:** the script checks `SHA256SUMS`. Eva checks the signature herself at each update.
- **The setup question for scripts:** `EVA_INSTALL_ENGINES=no` skips uv too, because uv is one more missing program.
