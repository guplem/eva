# Eva reference

Every command and setting, for when the [README](../../README.md) is not enough. On a computer where Eva runs from source, type `bun run eva` where this page says `eva`.

## Commands

Run these on the computer where Eva runs. When Eva is already running, each command talks to her; otherwise it does the work itself.

| Command                          | What it does                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `eva setup`                      | Asks each question again. Enter keeps the current answer.                             |
| `eva setup --non-interactive`    | Reads each answer from an `EVA_*` variable, for scripts.                              |
| `eva doctor`                     | Checks the tools that each feature needs, and says how to install each one.           |
| `eva`                            | Runs Eva in this terminal (the service does this for you).                            |
| `eva service install`            | Starts Eva now, by herself each time you log in, and again after a crash.             |
| `eva supervise`                  | Runs Eva, and starts her again after a crash (the Windows service does this for you). |
| `eva status`                     | Starts with "All good" or the problems, then the sync, updates and phone address.     |
| `eva link`                       | Shows the address that opens Eva on your phone and other computers.                   |
| `eva chat`                       | Talks to Eva in this terminal.                                                        |
| `eva projects [words]`           | Searches your projects.                                                               |
| `eva work <project> <request>`   | Gives work to a project; a coding agent does it in a free copy of the code.           |
| `eva sync`                       | Brings in other computers' notes, then saves and pushes this computer's notes.        |
| `eva update [--check]`           | Installs the newest version, then restarts. `--check` only looks.                     |
| `eva hub`                        | Makes this computer the hub, which runs Telegram and the reminders.                   |
| `eva settings`                   | Lists every setting; `(vault)` marks the settings that every computer shares.         |
| `eva settings get <key>`         | Shows one setting, such as `updates.frequency`.                                       |
| `eva settings set <key> <value>` | Changes one setting, such as `eva settings set updates.frequency weekly`.             |
| `eva --home <folder> <command>`  | Runs the command for another Eva on the same computer.                                |

## Settings

Eva keeps two kinds of settings:

- **Your settings live in your notebook,** in `.eva/settings.json`, so every computer with the notebook uses the same ones: the time zone, updates, the notebook fetch, the default engine and model, the Google account, and the voice language.
- **This computer's settings live in Eva's home folder** (`~/.config/eva` on Linux, `%APPDATA%\eva` on Windows). `config.json` holds the notebook folder, the machine name, the port, the project folders, the program paths, the Telegram chat, and the remote access settings. `secrets.json` holds the tokens. Tokens never go in the notebook.
- **Settings that decide who gets in, and what an agent may do, stay on each computer:** the trusted GitHub owners, the allowed Tailscale accounts, and Google's access (read-only, and which services). Eva's AI agent edits the notebook as part of its work, so these never live there.

Change a setting on the web Settings page, or with `eva settings set`. The update frequency and the notebook fetch apply at once; any other change applies at the next restart.

- **Tokens:** paste the GitHub, Telegram and Claude Code tokens on the Settings page. The page never shows a saved token again. Press **Test** to check it. Then press **Restart Eva**, so that conversations and the notebook sync use it too.
- **Test buttons:** each one makes a small, real check. The engine Test sends one tiny prompt, so it uses a little of your subscription.
- **A device that logged in through Telegram** can change only your notebook settings, the sync and the project folders. It cannot change a token or a security setting, so a lost phone cannot let a stranger in. To change them, log in with the token. You can also run `eva setup` or `eva settings set` on that computer.
- **Theme and density** stay in each browser, so a phone and a computer can differ.

## Several computers

Eva works on several computers with one notebook, with no role to set.

- **The hub** runs the Telegram bot and the reminders. The first computer that starts with the notebook becomes the hub; the notebook names it in `.eva/hub.json`.
- **A satellite** is any other computer with the notebook. It keeps the notebook in step and serves its own terminal and web page, but stays quiet in Telegram.
- **Move the hub** with **Make this machine the hub** on the Settings page, or `eva hub` on the new hub. The old hub stops its bot and reminders at its next fetch (5 minutes by default).
- **Two Evas on one computer** work too, one for each person: see [A second person on the same computer](setup.md#a-second-person-on-the-same-computer).

## Updates

Eva looks for a new version every day by default (`updates.frequency`: `off`, `hourly`, `daily` or `weekly`). She installs it only when no conversation is running, then restarts.

- **Installed from source** (`git clone`): Eva takes the newest version of `main`, and runs `bun install` when the dependencies changed. She never touches a copy with your own changes, your own commits, or another branch.
- **Installed as one executable** (a GitHub release): Eva takes the newest signed release.
- **Update now:** the **Update now** button in Settings, `/update` in Telegram, or `eva update`.

## Notebook sync

Eva saves the notebook to GitHub by herself:

- She brings in other computers' notes before each conversation turn, and every 5 minutes (`sync.pullIntervalMinutes`; `null` means only before each turn).
- She saves and pushes after each turn, and every minute when something changed.
- **Sync now:** the **Sync now** button in Settings, `/sync` in Telegram, or `eva sync`.
- **Files that Eva keeps out:** a file that looks like a secret (outside `Projects/`), and any file over 50 MB, because GitHub refuses files over 100 MB. `eva status` and the Settings page name them.

### Notebook conflicts

A conflict happens when two computers change the same lines of a note before they sync. Eva never throws a change away. She stops pushing and names the files in `eva status`. To fix it, on Eva's computer:

1. Open each named file. Find the blocks between `<<<<<<<` and `>>>>>>>`, keep the text that you want, and delete the markers.
2. In the notebook folder, run `git add <file>` for each file.
3. Run `eva sync`.

Eva never drops git's stash, so `git stash list` can still hold a copy of your edits.

## Problems and alerts

Eva sends each alert to your Telegram chat when the problem starts, again once a day while it lasts, and once more when it ends. The open problems also show at the top of the web page, because Telegram itself can be the problem.

| Alert                                   | When                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| The notebook sync stopped on a conflict | Two computers changed the same note: see [Notebook conflicts](#notebook-conflicts). |
| The notebook sync failed                | A git step failed, for example a full disk or a refused push.                       |
| The notebook cannot reach GitHub        | The notebook was offline for more than 30 minutes.                                  |
| The update check or install failed      | The alert names the step. A failed install keeps the old version.                   |
| A reminder failed to run                | The alert names the reminder.                                                       |
| Eva started after an unclean exit       | A crash or a power cut stopped her. Send `/logs`.                                   |
| Eva cannot read Telegram                | Another program uses the bot, or Telegram failed for over 15 minutes.               |

From a phone: `/status` shows the problems, `/logs [n]` shows the last `n` warnings and errors (20 by default), and `/restart` restarts Eva after you confirm. The Settings page has a **Restart Eva** button too.

## Logging in to the web page

- **Through Tailscale** (your phone, other computers): the first time on each device, the page shows a short code and Eva asks in Telegram whether to allow it. Tap **Allow** when the code matches; the device stays logged in for a year. Only the Tailscale account that owns Eva's computer can ask. To let other accounts ask, list them all in `remoteAccess.allowedTailscaleIdentities`.
- **When no Telegram bot runs on that computer** (a satellite, or no bot token), the page asks for the token instead.
- **On the computer itself** (advanced): the page also listens at `http://127.0.0.1:7420` (or that Eva's port), for that computer only. It asks once for the token `localApiToken` from `secrets.json` in Eva's home folder. The `eva` commands on that computer read the token by themselves.
- **End every device login:** tap "Log out every device" on the Settings page.
- **Keep Eva off Tailscale:** run `eva settings set remoteAccess.tailscaleServe false`.

## Optional features

Each feature stays off until you set it up. `eva doctor` shows which tools are missing.

- **Reminders and repeated tasks.** Ask Eva for a reminder or a daily summary, or use **Add schedule** on the Settings page. Eva writes them in `.eva/schedules.json` in the notebook. Before one first runs, Telegram shows a card with every detail: check it. Only the hub runs them.
- **Files.** Eva can send a notebook file in Telegram. She saves each file, photo or audio file that you send her in `Scratch/received/` in the notebook. Git never saves `Scratch/`, and Eva deletes its files after a week.
- **PDFs.** Install [typst](https://github.com/typst/typst/releases). Eva then writes a PDF in `Scratch/` and sends it.
- **Voice notes.** Install [ffmpeg](https://ffmpeg.org/download.html) and [whisper.cpp](https://github.com/ggml-org/whisper.cpp), download a model (for example `ggml-base.bin`, which reads Spanish and English), and put it at `voice/ggml-base.bin` in Eva's home folder. The audio never leaves the computer.
- **Google (Calendar, Drive, Contacts, Tasks).** Install [uv](https://docs.astral.sh/uv/). Create an OAuth client in Google Cloud, of type "Desktop app", and set its publishing status to "In production", so that the login does not expire after 7 days. Put its id and secret in `secrets.json` as `googleOauthClientId` and `googleOauthClientSecret`, and set your account with `eva settings set google.email <address>`. The first Google request gives you a link to log in. Eva starts with read-only access; set `google.readOnly` to `false` to let her add events. She asks you before any change that reaches other people, such as an invitation.
