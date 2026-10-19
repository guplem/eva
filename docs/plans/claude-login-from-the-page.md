# Plan: log in to Claude Code from the web page

Issue: #196.

## Why

Eva works from a phone. Today the Claude Code login needs a terminal: the person runs `claude setup-token`, then pastes the token into the page. A person who is new to terminals cannot finish the setup alone.

## Facts that we checked

- `claude setup-token` prints nothing when its output is a pipe. It needs a terminal.
- Under a pseudo-terminal (a fake terminal that a program can drive), it prints the login address as a terminal link, then waits at "Paste code here if prompted >".
- Bun 1.4.2, the version of Eva and CI, has a `terminal` option on `Bun.spawn`. It gives a pseudo-terminal on Linux and macOS, and ConPTY on Windows.
- pi's `/login` runs only in pi's own terminal UI. Eva cannot drive it from the page.

## Design

1. **A terminal seam** in `src/shared/terminal-process.ts`: `TerminalProcessStarter`. It starts a command in a pseudo-terminal and gives its output as text, a way to write to it, its exit, and a stop. Tests replace it with a fake.
2. **`ClaudeLogin`** in `src/core/setup/claude-login.ts`:
   - `start()` stops any old login, starts `claude setup-token` with `engineToolEnvironment` (the instance's Claude folder, no token), and waits for the address. It returns `{ url }`.
   - `finish(code)` writes the code and Enter, and waits for a token that starts with `sk-ant-oat`. It returns the token.
   - Each wait has a timeout. An unused login stops after 15 minutes.
   - Each failure is an `EvaError` with the new code `claude_login_failed`, and a message that says how to try again.
3. **`Eva.startClaudeLogin()` and `Eva.finishClaudeLogin(code)`.** The finish saves the token as the `claudeOauthToken` secret, the same as the paste field.
4. **API:** `POST /api/engines/claude-code/login` and `POST /api/engines/claude-code/login/finish`, the same shape as the Google login.
5. **Web page:** the Claude Code card shows "Log in to Claude", then a link to Claude's page and a field for the code. The old steps with `claude setup-token` and the token field stay, folded under "Or paste a token", for a machine with no claude program or a person who has a token already.
6. **pi card:** says in plain words that the pi login needs a terminal on Eva's computer, and that Claude Code needs none.

## Gaps and decisions

- **Which program?** Decision: the `claudeExecutable` that `main.ts` already finds with `locateEngineProgram`. With no program, the button is off and the card says so.
- **Which environment?** Decision: `engineToolEnvironment`. It sets the instance's `CLAUDE_CONFIG_DIR` and holds no old token.
- **How to find the address?** Decision: strip the terminal codes and match the first `https://` address that holds `oauth/authorize`. A wide terminal (500 columns) keeps it on one line.
- **Restart?** Decision: the same as a pasted token. The engines read the token at start, so the page says to press Restart Eva.
- **A new error code?** Decision: yes, `claude_login_failed`. Adding a code breaks no stored data.
- **Windows:** Bun's docs say that `terminal` uses ConPTY there. The seam test runs on the Windows CI job too.
