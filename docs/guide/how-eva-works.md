# How Eva works inside

This page explains how Eva works inside: her parts, what happens when you send a message, and how she keeps your vault and your computer safe. Read it to understand Eva, or to start to change her code. You can also ask Eva herself: she reads this page when you ask how she works.

The code is the source of truth. When this page and the code disagree, the code is right, and this page has a bug. [AGENTS.md](../../AGENTS.md) holds the rules for the people and agents who change Eva.

## The big picture

Eva is one program that runs on a computer of yours. She does not think by herself. For each message, she starts an AI harness, such as Claude Code or pi, and sends it your text. She then shows the answer on each front end, and saves the vault to GitHub.

```text
 Phone or computer                 The computer that runs Eva
 ┌───────────────┐               ┌──────────────────────────────────────────┐
 │ Telegram      │──── internet ─┼─▶ Telegram bot ─┐                        │
 │ Web page      │── Tailscale ──┼─▶ local API ────┼─▶ core ─▶ engine ─▶ AI │
 │ Terminal      │───────────────┼─▶ local API ────┘     │                  │
 └───────────────┘               │                       ▼                  │
                                 │          vault (git) ◀─▶ GitHub          │
                                 └──────────────────────────────────────────┘
```

| Part          | What it does                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| **Core**      | Holds the chats, the projects, the settings, the vault sync, the schedules, the alerts and the updates. |
| **Engine**    | Runs one harness. Eva has two engines: Claude Code and pi. The core never knows which harness answers.  |
| **Front end** | Shows the chats to you: Telegram, the web page and the terminal. Each front end shows the same chats.   |
| **Vault**     | Your notes, in a git repository. Eva pulls it before a turn, and saves and pushes it after the turn.    |

## One Eva on a computer

**One instance, one process.** An instance is one Eva with her own name, vault, logins and Telegram bot. Each instance runs as one core process. A computer can run any number of instances, such as one for each person.

**The instance folder.** Each instance keeps her files in her own folder: `eva-<name>` in `~/.config` (or in `XDG_CONFIG_HOME`) on Linux, or in `%APPDATA%` on Windows. The folder holds, among other files:

| File or folder | What it holds                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `config.json`  | The settings of this computer, and every security setting. See [Settings](reference.md#settings).               |
| `secrets.json` | The tokens. They never go in the vault.                                                                         |
| `state/`       | The list of chats, the steps of each turn, the schedules state, the notification history and other state files. |
| `engines/`     | The config folder of each harness, so each instance has her own logins.                                         |
| `widgets/`     | A read-only copy of each widget.                                                                                |
| `logs/`        | The log files.                                                                                                  |

Eva writes each state file atomically: she writes a new file, then renames it. She reads each file tolerantly: a broken file gives an empty value, never a crash.

**Programs are shared.** Every instance on a computer uses the same git, Claude Code, pi, uv, gh and Tailscale. Only the logins, the vault, the bot, the settings and the commit identity belong to one instance.

**The supervisor.** On Linux, a systemd user service starts Eva, and starts her again after a crash. On Windows, Eva's own supervisor (`eva supervise`) does this job, and starts at logon. On Windows, a small tray icon next to the clock shows her state.

## The layers of the code

Eva is written in TypeScript and runs on Bun. A release is one executable file. The code in `src/` has four layers:

| Folder           | What it holds                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `src/shared/`    | Types, the events, the errors, and the seams. A seam is an interface that a test replaces.      |
| `src/core/`      | Eva's decisions: chats, modes, projects, vault, settings, alerts, schedules, widgets, updates.  |
| `src/engines/`   | One adapter for each harness: `claude-code/` and `pi/`.                                         |
| `src/frontends/` | The terminal (`cli/`), Telegram (`telegram/`), the local API (`api/`) and the web app (`web/`). |

`src/main.ts` only joins the layers. A check (`bun run arch`) refuses an import that crosses the layers in the wrong direction. For example, the core never imports an engine.

Eva starts each child program through a seam, with a timeout, and with a short list of environment variables. A child program gets only the secrets that it needs. For example, Claude Code gets your Claude login token, but never the Telegram token.

## What happens when you send a message

This is one turn of an Assistant chat:

1. **A front end sends your text** to the core. Telegram calls the core directly. The web page and the terminal call the local API.
2. **The core finds the chat.** A chat runs one turn at a time. A message that you send during a turn waits in line, and joins the next turn.
3. **Eva pulls the vault,** and takes a snapshot of it. The snapshot lets you undo the turn later.
4. **Eva builds the prompt:** her own prompt, your rules in `.eva/assistant.md`, your pinned files, your format settings and your widgets. A running chat keeps the prompt of its first turn.
5. **The engine starts the harness** in the vault folder, with the model and the effort of the chat.
6. **The harness works.** The engine turns each step of the harness into an event, such as a tool call, a text part or a question to you. The core gives each event a sequence number, removes each secret from its text, and sends it to every front end.
7. **The turn ends** with exactly one end event: finished or failed.
8. **Eva takes a second snapshot, then saves the vault:** she commits each changed file and pushes the commit to GitHub.

Each front end shows the events in the order of their sequence number, never in the order of their time.

## The kinds of chat

Eva runs a chat in one of these modes. [Chats](reference.md#chats) and [Projects](reference.md#projects) explain them for daily use.

| Mode                     | Where the harness runs            | What Eva adds                                                                                      |
| ------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Assistant**            | The vault folder                  | Her prompt, her own skills (`eva-core`), the skills in the vault's `.eva/skills/`, and vault sync. |
| **Project, in a clone**  | `repos/clone-<n>/` of the project | Nothing, except `repos/AGENTS.md`. That file tells the chat where the project's notes are.         |
| **Project, in a folder** | The project folder in the vault   | No prompt. Eva turns off the harness's memory and hooks, and syncs the vault around each turn.     |

A project folder chat is a specialist, such as a gym coach, or a general project, such as a house build. Its `AGENTS.md` holds its only instructions.

A Project chat is a clean wrapper. It runs as if you opened the folder yourself. Eva hides every instruction file above the project folder, so the chat does not know that it runs inside Eva.

**A model call** is one short question to a model, outside every chat, such as a name for a new chat. It runs with no tools, no settings and no saved session, because its text can come from other people.

## The engines

An engine adapter turns the harness's output into Eva's events, and turns Eva's settings into the harness's options. It reads only structured fields, never English text.

**Claude Code.** Eva runs the installed `claude` program through the Claude Agent SDK. She never puts `claude` inside her own executable. It uses your subscription login, never an API key.

**pi.** Eva runs `pi --mode rpc` as a child process, and reads its JSON output line by line. pi never runs inside the core process, so it never sees the secrets that it does not need. pi uses your own subscription login or API key, but never a Claude login. Eva adds small pi extensions for the approvals, the questions, the context, the subagents and the MCP servers.

Each instance gives each harness its own config folder (`CLAUDE_CONFIG_DIR` and `PI_CODING_AGENT_DIR`), so two instances never share a login.

## The front ends

**The local API** listens on `127.0.0.1` only, on port 7420 by default. It serves HTTP for commands, a WebSocket for the events, and the web app. Each request must have the right `Host` and `Origin`. The terminal commands, such as `eva chat` and `eva status`, use this API too.

**The web page** reaches the local API through `tailscale serve`. Tailscale makes the address work only on your own devices. Eva never uses a public tunnel. A new browser logs in with the token from `secrets.json`, or with a device login that you allow in Telegram, the terminal or another logged-in page. See [Logging in to the web page](reference.md#logging-in-to-the-web-page).

**The Life pages** of the web page read `Life/` through the Life catalog, `src/core/life/life-catalog.ts`. It lists the entity folders of five kinds and reads the main file of each. It only reads. It writes nothing and follows no link. Each read has a size limit: a list reads only the start of each main file, and the page of one entity reads its text. A bad file gives a warning, never a failure. It skips secret and encrypted files. Eva redacts each text before it leaves the core, as for every other event.

**Telegram** runs only on the hub. The bot talks only to the one Telegram chat that you paired. Each Telegram topic is one Eva chat.

## The vault

**Eva owns the vault sync in her own code.** No harness hook does it. The sync:

- Pulls before each turn that works in the vault, then commits and pushes after it.
- By default, runs an idle sweep every minute, and a pull every 5 minutes. The settings can change both. No sync step runs during a turn in the vault.
- Never enters `Projects/*/repos/`: each clone has its own git.
- Never loses a change. On a conflict, Eva stops the pushes and asks you to pick a version. See [Vault conflicts](reference.md#vault-conflicts).
- Leaves out a file that looks like a secret, and tells you. See [Encrypted files](reference.md#encrypted-files).

**The vault layout is a contract.** A project is `Projects/YYYY-MM-DD-HHmm-name/`. Its clones are in `repos/clone-<n>/<repo>/`. Eva's own files are in `.eva/`, such as the hub claim, the schedules and the vault settings.

**The template.** Each new vault gets the files of `templates/vault/`. Some files are template parts, such as the text actions. Eva keeps a template part up to date, but never overwrites a part that you changed. A larger change to the vault's folders is a vault upgrade. See [Vault structure](reference.md#vault-structure).

**Migrations.** A new Eva can change the format of a stored file. A migration in `src/core/migrations/` makes that change once, on each computer or in the vault. Only the hub migrates the vault.

## Several computers

Two or more computers can run Eva with the same vault. The vault names the hub in `.eva/hub.json`. The hub runs the Telegram bot, the schedules and the vault migrations. Each other computer is a satellite: it syncs the vault, but stays quiet in Telegram. Each computer reports its open problems in `.eva/machines/<computer>.json`, and the hub shows them. See [Several computers](reference.md#several-computers).

## Safety

- **Remote access only through Tailscale.** The local API listens on the computer itself. Tailscale gives the address to your devices only.
- **Settings have homes.** Your personal settings live in the vault. The settings of the computer, and each security setting, stay in `config.json`. An agent can edit the vault, so Eva never reads a security setting from it.
- **Secrets never reach a front end.** The `Redactor` removes each known secret, and each common token shape, from the text of each event and log line.
- **The file wall.** A Project chat cannot open the vault, the other projects or Eva's folder. On Linux and macOS, a sandbox also walls the shell of the chat, when the computer can run it. See [What a chat can reach](reference.md#what-a-chat-can-reach).
- **Trust of a clone.** A clone of an unknown repository runs with its hooks, project settings and MCP servers off, until you trust it.
- **Signed updates.** See below.

## Updates

After the checks pass on `main`, the release workflow publishes a release when a change alters the executable. The commit prefixes decide the version number. The workflow signs the list of checksums with a key that only it holds. Eva checks the signature before she replaces her executable, so a changed download never runs.

Eva installs an update only when no chat runs a turn. Your update policy decides which releases she installs by herself. An Eva that runs from a git checkout updates with a fast-forward of `main`. See [Updates](reference.md#updates).

## Problems and alerts

Each problem has a stable key. Eva tells you when a problem starts, once a day while it lasts, and once when it ends. Each problem names the button or the command that fixes it, so you can fix most problems from your phone. See [Problems and alerts](reference.md#problems-and-alerts).

## Where to look in the code

| To understand                     | Read                                                  |
| --------------------------------- | ----------------------------------------------------- |
| How the parts join                | `src/main.ts`, `src/core/eva.ts`                      |
| One turn of a chat                | `src/core/sessions/session-manager.ts`                |
| The modes                         | `src/core/modes/`                                     |
| What an engine must do            | `src/shared/engine-port.ts`, `src/shared/events.ts`   |
| The vault sync                    | `src/core/vault/vault-sync.ts`, `vault-upkeep.ts`     |
| The hub and the satellites        | `src/core/instance/hub.ts`                            |
| The settings                      | `src/core/settings/home.ts`                           |
| The local API and its guards      | `src/frontends/api/local-api.ts`                      |
| The updates                       | `src/core/updates/`                                   |
| The widgets                       | `src/core/widgets/`, [docs/widgets.md](../widgets.md) |
| What the previous version learned | [docs/lessons-from-v1.md](../lessons-from-v1.md)      |

Many folders have their own `AGENTS.md` with the rules of that part. Code comments cite a lesson as "lesson N", and an issue as "#N".
