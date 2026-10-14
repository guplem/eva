# One core process per instance, with front ends as clients of a local API

## Context

Eva runs on a Linux server and is reached from any device: a terminal, Telegram, and a web UI (intent goal 5). The core owns the vault, so two writers must never race (lessons 20, 30). Several instances can run on one machine, for one person or several (D11). The web UI gives full shell access, so it must never be open to the internet (D10).

Source: plan §1 (D6, D10, D11, D13), §4.3, §4.4, §12; lessons 20, 54, 85, 89.

## Decision

- **One core process per instance.** It holds `<home>/eva.lock`. A second start exits with code 3.
- **The core serves a local API on its port:** HTTP for commands, WebSocket for events. `eva chat`, `eva status`, the web UI, and other tools are clients of this API. Telegram runs inside the core.
- **The API listens on `127.0.0.1` only.** It checks `Host` and `Origin` on every request and every WebSocket upgrade. Local clients send a token from `<home>/secrets.json`. Remote access goes only through `tailscale serve`, with the Tailscale identity header checked against the instance's allowlist. Never `0.0.0.0`, never Tailscale Funnel, never a public tunnel.
- **Exit codes are a contract with the supervisor** (lesson 89): `0` clean stop, `1` crash, `2` bad config, `3` second instance (never retried), `4` restart for an update.
- **Each instance has its own home folder,** port (default 7420), vault, and state files. Writes are atomic, and a bad file never crashes Eva (lesson 54).
- **One conversation list per instance** (D13). Every front end shows the same list.

Parts that have no code yet are planned for phase P3 (core and API) and P5 (web UI).

**Rejected alternatives:**

- **A native desktop app that holds the machine access.** The background service holds the access, so the UI can be a web page. A desktop window can come later (intent item 8).
- **Several processes that each touch the vault.** v1's `mkdir` and `flock` locks raced, and Windows has no `flock` (lessons 20, 21). One process with an in-process lock owns the vault.
- **One server process for many people.** Out of scope: each person runs their own instance (intent "Out of scope").

## Consequences

**Positive:**

- A chat started in Telegram continues in the web app and the terminal.
- The supervisor (systemd, or a Windows logon task) maps exit codes to restart rules: `RestartPreventExitStatus=2 3`.

**Trade-offs and follow-up:**

- Whoever controls a front end controls the machine as the instance's OS user (plan §12). The `Host`, `Origin`, token, and identity checks need rejection tests (P5 "done when").
- Instances on one OS user can read each other's files. The owner accepts this; forbidden paths come later (plan §7.3).
