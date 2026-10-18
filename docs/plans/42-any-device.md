# Plan: use Eva from any device (#42)

This is the working plan for #42. The last commit of the PR deletes it.

## Goal

A new person goes from a fresh server to a shareable link by following Eva's own guidance: in the web page, in `eva setup`, in `eva link` and in Telegram `/link`. Eva installs Tailscale where she can, shows each step that needs the person with its link, and finds a Tailscale that becomes ready after she started, with no restart.

## Steps

1. **Read every Tailscale state.** `readTailscale` returns only "running" or null today. Return a state instead: missing, stopped, needs a sign-in (with the sign-in link from `AuthURL`), or running. Find the `tailscale` program also where Eva's own install puts it.
2. **One remote access state for every front end.** Add a step to `RemoteAccess`: install, start, sign in, HTTPS, ready or failed, with the link that the step needs. `remoteAccess` is null only when `remoteAccess.tailscaleServe` is off.
3. **A watcher in the core.** It reads the state, publishes with `tailscale serve` when it can, and reads again on a timer while the address is missing. It replaces the start-time read and `publishRetry` in `src/main.ts`.
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

(Filled in after the gap review.)
