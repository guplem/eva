# Plan: Eva in the Windows system tray (#457)

## Why

Since #407, Windows starts Eva at logon under `conhost.exe --headless`. No window and no icon show. A person who does not know `eva status` or `eva open` cannot see that she runs, and cannot open her page.

## What

- On Windows, `eva supervise` starts a tray icon beside Eva. The icon lives as long as the supervisor.
- The icon shows Eva's face for her state, and a tooltip with the words. The menu has a title with the instance name, then **Open Eva**, **Restart Eva** and **Quit Eva**. A double click opens Eva.
- Each Eva has her own supervisor, so each Eva has her own icon. The title and the tooltip name the instance.

## Design

- **The tray is a view.** A PowerShell script draws the icon with WinForms and GDI+, which every Windows has. It needs no administrator and no new dependency. All the logic stays in TypeScript, where tests reach it.
- **A line protocol.** The supervisor writes one JSON line for each state: face, tooltip, title, and whether Open works. The script writes one word for each menu choice: `open`, `restart` or `quit`. When its input ends, the script removes the icon and exits.
- **A new seam, `LineProcessStarter`** (`src/shared/line-process.ts`), for a long child that speaks lines on its input and output. The process runner has a timeout, and the long-process seam has no pipes. Its stop is bounded, as for `LongProcessStarter`.
- **The script ships inside Eva:** `src/frontends/cli/tray.ps1`, imported `with { type: "text" }`. PowerShell gets it with `-EncodedCommand`, so no file and no execution policy matter.
- **The state** comes from the supervisor (Eva starts, runs, waits after a crash, or stopped) and, while she runs, from `/api/status` every few seconds. The faces reuse `navVisorState` and `stateFaces`, the one map from Eva's states to faces.
- **Restart Eva** asks Eva for a restart through the local API, as the Restart button of the page does. When she does not answer, the supervisor stops her and starts her again at once.
- **Quit Eva** stops the supervisor. Windows has no gentle signal for another process, so the supervisor first asks Eva for a restart through the API, so that she stops cleanly. The supervisor then does not start her again. The Run key stays, so she starts again at the next logon.
- **After a stop for good** (bad settings), the icon stays with the stopped face. Restart Eva starts a new supervisor run. A second instance (exit code 3) ends the supervisor and its icon: the other copy has its own icon.

## Gaps and decisions

1. **How to show an icon with no new dependency and no administrator?** PowerShell 5.1 with WinForms `NotifyIcon`. Every Windows 10 and 11 has it. Decided.
2. **Which seam starts the tray?** No current seam fits. A new `LineProcessStarter` in `src/shared/`, listed in the `AGENTS.md` rule. Decided.
3. **How does Quit stop Eva cleanly on Windows?** The local API restart, while the supervisor is stopping. No new API route. Decided.
4. **Which faces?** The faces of the nav visor through `navVisorState`, plus `waiting` while she starts, `failed` while she waits after a crash, and `resting` after she stopped. The script draws each of these. Decided.
5. **Linux?** No tray: systemd runs Eva, not the supervisor. Out of scope.
