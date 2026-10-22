# Plan: Windows start without admin, `eva open`, and a clean Ctrl+C (#407)

## Why

A first install on Windows 11, from a normal PowerShell, failed at the start step. The logon task needs an administrator. So setup skipped "Your devices" and the "finish here or on the page" question. The person also had no clear way to open Eva on the same computer, and Ctrl+C printed a stack trace.

## Decisions (from the owner)

1. **Start at logon with no admin.** Write a value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. The value runs `conhost.exe --headless <eva> supervise --instance <name>`. `conhost.exe` is a GUI program, so Windows opens no console window. The headless console hosts the supervisor and Eva.
   - Start now: `powershell Start-Process` with the same command. A child of `ProcessRunner` gets NUL for its input, and then `conhost --headless` stops at once (tested on Windows 11).
   - An old `Eva-<name>` task: delete it, so two supervisors never start. When the delete fails, keep the task: it works, and Eva starts with `schtasks /Run`.
   - Remove the "Run as administrator" advice.
2. **The same setup steps on Windows and Linux.** The start now works, so "Your devices" and the choice show. A failed start says what to run.
3. **`eva open` and a login link.** The terminal asks the running Eva for a login link, with the local token. The link is `http://127.0.0.1:<port>/#login=<secret>` (a fragment, never a query string, so no server log keeps it). The browser trades the secret for a device cookie.
   - The secret is 32 random bytes. Eva keeps only its SHA-256 hash, in memory.
   - It works once, for 2 minutes, and only from a local request (`127.0.0.1`, no Tailscale headers).
   - Setup asks "Open Eva in this computer's browser now? [Y/n]" in "Your devices", when this computer has a desktop.
   - The setup line and the login page never name `secrets.json`. Only `reference.md` keeps the token, as the last way in.
4. **Ctrl+C at a question:** one line, "Setup stopped. Each answer is saved. Run `eva setup` to go on.", and exit code 0.
5. **Docs:** `docs/guide/setup.md`, `docs/guide/reference.md` and `README.md`.

## Gaps and answers

- **Does `conhost --headless` show a window?** No. Tested: no main window, and the child keeps running after its parent exits.
- **Does the Windows browser opener keep the fragment?** `rundll32 url.dll,FileProtocolHandler <url>` keeps it (tested). `cmd /c start` would split the URL at `&`.
- **A local program can see the link in the browser's command line.** It could use the link first. The same program can read `secrets.json` already, so the link adds no new risk for the same user. The link is single use and short-lived.
- **Ctrl+C outside a question.** The prompt listens for SIGINT, so Ctrl+C at any moment of a prompt stops setup with the same line.
