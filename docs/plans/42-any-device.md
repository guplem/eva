# Plan: use Eva from any device (#42)

This is the working plan for #42. The last commit of the PR deletes it.

## Goal

A new person goes from a fresh server to a shareable link by following Eva's own guidance: in the web page, in `eva setup`, in `eva link` and in Telegram `/link`. Eva installs Tailscale where she can, shows each step that needs the person with its link, and finds a Tailscale that becomes ready after she started, with no restart.

## Steps

1. **Read every Tailscale state.** `readTailscale` returns only "running" or null today. Return a state instead: missing, stopped, needs a sign-in (with the sign-in link from `AuthURL`), or running. Find the `tailscale` program also where Eva's own install puts it.
2. **One remote access state for every front end.** Add a step to `RemoteAccess`: install, start, sign in, HTTPS, ready or failed, with the link that the step needs. `remoteAccess` is null only when `remoteAccess.tailscaleServe` is off.
3. **A watcher in the core.** It reads the state, publishes with `tailscale serve` when it can, and reads again every 30 seconds, also while ready. It replaces the start-time read and `publishRetry` in `src/main.ts`.
4. **Dynamic hosts in the local API.** The Tailscale host name and the owner's login can arrive after the start. The host and identity guards read them on each request.
5. **Install Tailscale.** Windows: `winget`. Linux: the userspace install from the guide (static build, a user service, no root). Elsewhere: the steps only. `eva setup` offers it, and the web page has a button for it.
6. **Sign in from the web page.** A button runs `tailscale up` and shows the link. The page reads the status every few seconds until the step is done.
7. **The setup steps as text.** One function builds the steps for the current state, and the 3 steps for each new device. `eva setup`, `eva link`, Telegram `/link` and the web page show them.
8. **Share the address.** The web page shows a Copy button, a Share button (where the browser has `navigator.share`) and a QR code. `eva link` and `eva setup` print the QR code in the terminal.
9. **Docs.** Update `README.md` ("What you need") and `docs/guide/setup.md` ("Open Eva on your phone").

## Gaps

1. Where does the web section live: the top of Settings, or also a notice on the main page?
2. The QR code: a small dependency, or our own encoder?
3. Which installs does Eva run? Linux with `sudo`, macOS, and `winget` that needs an administrator.
4. May the running Eva install Tailscale from a web request, or only `eva setup`?
5. How does `RemoteAccess` grow without a break? It is a sent schema.
6. Do dynamic hosts and identities in the local API weaken a guard?
7. Where does the shared step text live, inside the layer rules?

## Decisions

Three review agents read the gaps. Their answers agreed, so no gap needs the owner.

1. **Web section:** the top of Settings, always shown while `remoteAccess` is not null. No notice on the main page: a missing Tailscale is an optional feature, not a problem (#13 moves remote access into Settings).
2. **QR code:** the `uqr` package, pinned. It has no dependencies, and it renders both SVG (web page) and text (terminal). The terminal always prints the plain address too.
3. **Installs:** `winget` on Windows. The userspace install on Linux, only when no `tailscale` program exists, so Eva never starts a second daemon. Never `sudo`. macOS and other systems get the steps only. The Windows installer can ask for administrator rights on the desktop; the step says so, and the run has a long timeout.
4. **Install and sign-in from the web page:** allowed for a token login only, as fixed actions with no arguments. The POST starts the work, and the page polls the status, as the engine update does. Telegram `/link` offers the same buttons, because before Tailscale works, Telegram is the only way to Eva from a phone.
5. **`RemoteAccess`:** add `step`, `link`, `account` and `busy`. Keep `url` and `problem`. A reader that gets no `step` (an older running Eva) derives it from `url`. `remoteAccess` is null now only when `tailscaleServe` is off; the PR says so.
6. **Live hosts and identities:** the local API reads the host name and the owner from one snapshot of the watcher on each request. The configured lists stay as they are. Before Tailscale is ready, only the loopback and configured hosts get in.
7. **Step text:** a pure module in `src/core/remote-access/`, with no Node imports, so the web bundle can use it. Each front end renders the buttons and the QR code.

Traps to handle:

- Find `tailscale` at `%ProgramFiles%\Tailscale\tailscale.exe` and at Eva's userspace install: Eva's PATH does not change after an install.
- Run the userspace build directly with `--socket=…`, not through the wrapper script.
- A root `tailscaled` refuses a normal user: show `sudo tailscale set --operator=$USER` as its own problem.
- The sign-in button runs `tailscale up --timeout=…` again for a fresh link.
- Remove the "restart Eva" text: the watcher reads the state every 30 seconds.
- `eva doctor` names `eva setup` as the way to install Tailscale.

## Review round 1

Five agents reviewed the work. Fixed:

- Install only after a fresh read says that no Tailscale exists. An old Telegram button or a direct POST could start a second daemon.
- Keep a failed install's cause on the start step too: a partial Linux install leaves a program but no daemon.
- Read fresh after an install or a sign-in, never a read that began before it ended.
- `tailscale down` is the start step, not a sign-in. A `null` status never crashes Eva. A sign-in link must be Tailscale's own login page.
- Publish a ready address again about every 10 minutes: a lost serve setting shows no change in the status.
- Keep the last known owner when a read fails, so the identity check stays on.
- Write the wrapper with `$HOME` and the unit with `%h`, so no home path lands in a shell or unit line.
- `eva setup` publishes too, so the address that it prints works as soon as Eva runs. The `publish` option is gone.
- Telegram runs the sign-in apart from its poll loop, checks for phone access that is off, and starts no second wait on a second tap.
- The web page keeps a slow read while ready, says "within a minute", and handles a browser with no clipboard.
- Setup no longer tells the person to run setup.
- Tests use the real watcher over a shared fake `tailscale` program (`test/support/fake-tailscale.ts`), not a hand-made control.
- Shared helpers: `stepLine`, `actionLabel` and `RemoteAccessBusy`.

Not changed, with the reason:

- **Each commit compiles on its own:** the commits are pushed already, and AGENTS.md forbids a force-push. Later commits keep one concern each.
- **Hide the Install button from a device login:** a device login exists only once Tailscale works, so it never sees the setup steps. The API refuses it anyway.
- **A new sign-in link when setup's wait times out:** the wait lasts 10 minutes. The person runs `eva link` or taps Sign in in Telegram or Settings for a fresh link.
- **Drop the `tailscale_install_failed` code:** the watcher branches on it to word a failure that is not Eva's own.
- **The macOS app path in `findTailscale`:** macOS gets the steps only, by decision 3.
