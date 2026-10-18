# Eva reference

Every command and setting, for when the [README](../../README.md) is not enough. On a computer where Eva runs from source, type `bun run eva` where this page says `eva`.

## Commands

Run these on the computer where Eva runs. `eva status`, `eva chat`, `eva projects` and `eva work` need Eva to run. The other commands also work when Eva is stopped.

| Command                          | What it does                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `eva setup`                      | Asks each question again. Enter keeps the current answer.                                 |
| `eva setup --non-interactive`    | Reads each answer from an `EVA_*` variable, for scripts.                                  |
| `eva doctor`                     | Checks the tools that each feature needs, and says how to install each one.               |
| `eva`                            | Runs Eva in this terminal (the service does this for you).                                |
| `eva service install`            | Starts Eva now, by herself each time you log in, and again after a crash.                 |
| `eva supervise`                  | Runs Eva, and starts her again after a crash (the Windows service does this for you).     |
| `eva status`                     | Starts with "All good" or the problems, then the sync, updates and phone address.         |
| `eva link`                       | Shows the address that opens Eva on your phone and other computers.                       |
| `eva chat`                       | Talks to Eva in this terminal. Type `/rename <title>` to name the chat, `/exit` to leave. |
| `eva chat --project <id>`        | Talks to a project's coding agent. `--clone <name>` picks the copy of the code.           |
| `eva chat --model <model>`       | Picks the model: `default`, `opus`, `sonnet` or `haiku`.                                  |
| `eva chat --engine <engine>`     | Picks the engine: `claude-code` or `pi`.                                                  |
| `eva projects [words]`           | Searches your projects. `status:active` and `tag:work` filter them.                       |
| `eva work <project> <request>`   | Gives work to a project; a coding agent does it in a free copy of the code.               |
| `eva sync`                       | Brings in other computers' notes, then saves and pushes this computer's notes.            |
| `eva update [version] [--check]` | Installs what the policy allows, or the version given. `--check` only looks.              |
| `eva hub`                        | Makes this computer the hub, which runs Telegram and the reminders.                       |
| `eva settings`                   | Lists every setting; `(vault)` marks the settings that every computer shares.             |
| `eva settings get <key>`         | Shows one setting, such as `updates.frequency`.                                           |
| `eva settings set <key> <value>` | Changes one setting, such as `eva settings set updates.frequency weekly`.                 |
| `eva version`                    | Shows Eva's version.                                                                      |
| `eva help`                       | Shows every command.                                                                      |
| `eva --home <folder> <command>`  | Runs the command for another Eva on the same computer.                                    |

## Settings

Eva keeps two kinds of settings:

- **Your settings live in your notebook,** in `.eva/settings.json`, so every computer with the notebook uses the same ones.
- **This computer's settings live in Eva's home folder** (`~/.config/eva` on Linux, `%APPDATA%\eva` on Windows), in `config.json`.
- **Settings that decide who gets in, and what an agent may do, stay on each computer.** The table marks them "(security)". Eva's AI agent edits the notebook as part of its work, so these never live there.
- **Tokens live in `secrets.json`** in Eva's home folder, never in the notebook: `githubToken`, `telegramBotToken`, `claudeOauthToken`, `localApiToken`, `googleOauthClientId` and `googleOauthClientSecret`.

In the notebook:

| Setting                           | Default        | What it does                                                                                                        |
| --------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `timeZone`                        | Asked at setup | The time zone of the reminders, and of the time in each message.                                                    |
| `sync.pullIntervalMinutes`        | `5`            | Minutes between two fetches of other computers' notes. `null`: only before each conversation turn.                  |
| `sync.sweepSeconds`               | `60`           | Seconds between two saves of changed notes.                                                                         |
| `updates.frequency`               | `daily`        | How often Eva looks for a new version: see [Updates](#updates).                                                     |
| `updates.install`                 | `minor`        | What Eva installs by herself: see [Updates](#updates).                                                              |
| `engines.default`                 | `claude-code`  | The engine of a new conversation: `claude-code` or `pi`.                                                            |
| `engines.claudeCode.defaultModel` | `default`      | The model of a new conversation: `default`, `opus`, `sonnet` or `haiku`.                                            |
| `engines.pi.models.<model>`       | `null`         | The pi model for each of these 4 names, such as `openai/gpt-5`. `null`: the `default` entry, then pi's own default. |
| `google.email`                    | `null`         | The Google account. The Google login sets it.                                                                       |
| `voice.language`                  | `null`         | The language of voice notes, such as `es`. `null`: whisper finds it.                                                |

On this computer:

| Setting                                              | Default                                    | What it does                                                                                   |
| ---------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `vaultPath`                                          | `vault` in Eva's home folder               | The notebook folder.                                                                           |
| `machineName`                                        | The computer's name                        | This computer's name in `.eva/hub.json`.                                                       |
| `port`                                               | `7420`                                     | The port of the web page on this computer.                                                     |
| `projectRoots`                                       | `[]`                                       | More folders of projects, beside `Projects/` in the notebook.                                  |
| `sync.enabled`                                       | `true`                                     | `false` stops the notebook sync on this computer.                                              |
| `engines.claudeCode.executable`                      | `null`                                     | The program that starts Claude Code. `null`: `claude`.                                         |
| `engines.claudeCode.ownConfigFolder`                 | `false`                                    | `true`: Claude Code keeps its login and settings in Eva's home folder, not in yours.           |
| `engines.pi.executable`                              | `null`                                     | The program that starts pi. `null`: `pi`.                                                      |
| `telegram.allowedChatId`, `telegram.allowedUserId`   | Set when you pair the chat                 | The Telegram chat, and the person in it who may act.                                           |
| `trust.trustedRepositoryOwners` (security)           | `[]`                                       | GitHub owners whose repositories Eva trusts at once, so their own agent settings apply.        |
| `google.services` (security)                         | `calendar`, `drive`, `contacts`, `tasks`   | The Google services that Eva may use. `gmail` is the fifth choice.                             |
| `google.readOnly` (security)                         | `true`                                     | `false` lets Eva change things, such as add events. Log in to Google again after a change.     |
| `voice.modelPath`                                    | `voice/ggml-base.bin` in Eva's home folder | The whisper.cpp model. Voice notes stay off without it.                                        |
| `voice.vadModelPath`                                 | `null`                                     | A whisper.cpp model that finds the silence, so that whisper skips it.                          |
| `voice.whisperExecutable`                            | `whisper-cli`                              | The whisper.cpp program.                                                                       |
| `voice.ffmpegExecutable`                             | `ffmpeg`                                   | The ffmpeg program.                                                                            |
| `remoteAccess.tailscaleServe`                        | `true`                                     | Publishes the web page to your Tailscale devices at start.                                     |
| `remoteAccess.allowedTailscaleIdentities` (security) | `[]`                                       | The Tailscale accounts that may ask for a device login. `[]`: only the owner of this computer. |
| `remoteAccess.hostNames`                             | `[]`                                       | More host names that reach the web page, beside `127.0.0.1` and the Tailscale name.            |

Change a setting on the web Settings page, or with `eva settings set`. The update frequency, the update policy and the notebook fetch apply at once. Any other change applies at the next restart.

- **Tokens:** paste the GitHub, Telegram and Claude Code tokens on the Settings page. The page never shows a saved token again. Press **Test** to check it. Then press **Restart Eva**, so that conversations and the notebook sync use it too.
- **Test buttons:** each one makes a small, real check. The engine Test sends one tiny prompt, so it uses a little of your subscription.
- **A device that logged in through Telegram** can change only your notebook settings, the sync and the project folders. It cannot change a token or a security setting, so a lost phone cannot let a stranger in. To change them, log in with the token. You can also run `eva setup` or `eva settings set` on that computer.
- **Theme and density** stay in each browser, so a phone and a computer can differ.

## Several computers

Eva works on several computers with one notebook, with no role to set.

- **The hub** runs the Telegram bot and the reminders. The first computer that starts with the notebook becomes the hub; the notebook names it in `.eva/hub.json`.
- **A satellite** is any other computer with the notebook. It keeps the notebook in step and serves its own terminal and web page, but stays quiet in Telegram.
- **A computer with an older Eva** than the notebook does not change the notebook's settings, reminders or hub until you update it. Its web page shows a warning, and the hub sends it to Telegram.
- **Problems on a satellite** reach Telegram through the hub. Each computer writes its open problems to `.eva/machines/<computer>.json` in the notebook, and the hub sends them. A notebook sync problem cannot travel this way: it shows on that computer only.
- **A computer that no longer runs Eva** leaves its file behind, and the hub keeps its alerts. Ask the Assistant to delete the file.
- **Move the hub** with **Make this machine the hub** on the Settings page, or `eva hub` on the new hub. The old hub stops its bot and reminders at its next fetch (5 minutes by default).
- **Two Evas on one computer** work too, one for each person: see [A second person on the same computer](setup.md#a-second-person-on-the-same-computer).

## Updates

Eva looks for a new version every day by default (`updates.frequency`: `off`, `hourly`, `daily` or `weekly`). She installs it only when no conversation is running, then restarts.

Each version has three numbers, `MAJOR.MINOR.PATCH`. A fix raises the last number, a new feature raises the middle one, and a change that can break something raises the first one. The update policy (`updates.install`) chooses what Eva installs by herself:

| Value             | Eva installs by herself                                    |
| ----------------- | ---------------------------------------------------------- |
| `patch`           | Fixes only.                                                |
| `minor` (default) | Fixes and new features. She holds back a major version.    |
| `major`           | Every release. A major version can break things that work. |

The policy lives in the notebook, so every computer follows the same one. When the policy holds back a newer version, Eva sends one Telegram message for it, and the status names it. When the notebook needs a newer Eva than this computer runs, Eva installs at least that version, whatever the policy says.

- **Installed as one executable** (a GitHub release): Eva takes the newest signed release that the policy allows.
- **Installed from source** (`git clone`): Eva takes the newest version of `main`, and runs `bun install` when the dependencies changed. The policy does not apply. She never touches a copy with your own changes, your own commits, or another branch.
- **Check and install:** the **Check and install** button in Settings, `/update` then **Install** in Telegram, or `eva update`. Eva installs what the policy allows, at once.
- **Update to a version:** the **Update to a version…** button in Settings, a version button under `/update` in Telegram, or `eva update 1.2.0`. Eva shows what the update brings, breaking changes first. She never installs an older version.
- **Update Claude Code:** the **Update Claude Code** button in Settings runs `claude update` and shows the result. The engine update waits until no conversation is running. If Claude Code was installed with a package manager, such as npm, update it with that tool.

## Notebook sync

Eva saves the notebook to GitHub by herself:

- She brings in other computers' notes before each conversation turn, and every 5 minutes (`sync.pullIntervalMinutes`; `null` means only before each turn).
- She saves and pushes after each turn, and every minute when something changed.
- **Sync now:** the **Sync now** button in Settings, `/sync` in Telegram, or `eva sync`.
- **Files that Eva keeps out:** a file that looks like a secret (outside `Projects/`), and any file over 50 MB, because GitHub refuses files over 100 MB. `eva status` and the Settings page name them.

### Notebook conflicts

A conflict happens when two computers change the same lines of a note before they sync. Eva never throws a change away. She stops pushing, names the notes, and sends an alert.

To fix it from your phone:

1. Send `/conflicts` in Telegram, or open **Settings** on the web page of the computer with the conflict.
2. For each note, tap one button:
   - **Keep mine:** keep this computer's version.
   - **Keep theirs:** keep the version that the other computer pushed.
   - **Keep both:** keep this computer's version, and put the other version in a copy beside the note, such as `Plan (conflict copy).md`.
3. After the last note, Eva pushes again by herself.

No pick loses a version. Git history keeps both versions of a note that was committed on both sides. An edit that was not committed yet stays in git's stash, which Eva never drops.

Only the hub runs Telegram, so `/conflicts` shows the hub's conflicts. For a conflict on another computer, open that computer's web page.

This needs git 2.38 or newer on the computer with the conflict. With an older git, the alert says so.

## Problems and alerts

Eva sends each alert to your Telegram chat when the problem starts, again once a day while it lasts, and once more when it ends. The open problems also show at the top of the web page, because Telegram itself can be the problem.

| Alert                                   | When                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| The notebook sync stopped on a conflict | Two computers changed the same note: see [Notebook conflicts](#notebook-conflicts).   |
| The notebook sync failed                | A git step failed, for example a full disk or a refused push.                         |
| The notebook cannot reach GitHub        | The notebook was offline for more than 30 minutes.                                    |
| The update check or install failed      | The alert names the step. A failed install keeps the old version.                     |
| The Claude Code update failed           | The alert names the reason. Chats keep the old version of Claude Code.                |
| A reminder failed to run                | The alert names the reminder.                                                         |
| A reminder waits for its card           | No card reached you, so it does not run: see [Optional features](#optional-features). |
| Eva started after an unclean exit       | A crash or a power cut stopped her. Send `/logs`.                                     |
| Eva cannot read Telegram                | Another program uses the bot, or Telegram failed for over 15 minutes.                 |

From a phone: `/status` shows the problems, `/logs [n]` shows the last `n` warnings and errors (20 by default), and `/restart` restarts Eva after you confirm. The Settings page has a **Restart Eva** button too.

## Logging in to the web page

- **Through Tailscale** (your phone, other computers): the first time on each device, the page shows a short code and Eva asks in Telegram whether to allow it. Tap **Allow** when the code matches; the device stays logged in for a year. Only the Tailscale account that owns Eva's computer can ask. To let other accounts ask, list them all in `remoteAccess.allowedTailscaleIdentities`.
- **When no Telegram bot runs on that computer** (a satellite, or no bot token), the page asks for the token instead.
- **On the computer itself** (advanced): the page also listens at `http://127.0.0.1:7420` (or that Eva's port), for that computer only. It asks once for the token `localApiToken` from `secrets.json` in Eva's home folder. The `eva` commands on that computer read the token by themselves.
- **End every device login:** tap "Log out every device" on the Settings page.
- **Keep Eva off Tailscale:** run `eva settings set remoteAccess.tailscaleServe false`.

## Conversations

- **One list.** Telegram, the web page and `eva chat` share the same conversations. Telegram shows a conversation from the web page or the terminal after `/chats`. Its topic then also shows the messages that they send.
- **Continue a conversation in Telegram:** send `/chats` and tap the conversation. It opens in a topic of its own, with its last 3 turns. Without topics, the main chat continues it.
- **Project work:** when Eva gives work to a project from Telegram, its conversation opens in a topic. In a group, Eva sends the link to that topic. When Tailscale gives Eva an address, she also sends the link to the conversation on the web page.
- **Delete a conversation:** send `/delete` in its topic, or tap **Delete chat** on the web page. It goes from Telegram, the web page and the terminal, with its forks. The engine keeps its own transcript.
- **Open one conversation on the web page:** add `#/chat/<id>` to the address. Telegram sends such links.

## Optional features

Each feature stays off until you set it up. `eva doctor` shows which tools are missing.

- **Reminders and repeated tasks.** Ask Eva for a reminder or a daily summary, or open the Schedules page with the ⏰ button next to **Schedules** in the Assistant list. Eva writes them in `.eva/schedules.json` in the notebook. Before a new or changed one runs, Eva shows a card with every detail. The card goes to Telegram, or to a dialog in the web app. Check it. In the web app, tap **Got it**, or tap **Remove schedule** if you did not make it. A schedule waits until a card reaches you, and Eva sends an alert. Only the hub runs them.
- **Chat names.** A chat takes the first line of its first message as its name. To name chats your way, write rules in **Settings** > **Chat names**, or ask Eva to. For example: "Lead every name with an emoji" or "Name an issue chat Implementing #N". After the first answer in a chat, a small model call names the chat by your rules. It uses your engine login: Haiku, the smallest Claude model, on Claude Code, and the chat's model on pi. The rules live in `.eva/chat-names.md` in the notebook. Your own rename always wins.
- **Files.** Eva can send a notebook file in Telegram. She saves each file, photo or audio file that you send her in `Scratch/received/` in the notebook. Git never saves `Scratch/`, and Eva deletes its files after a week.
- **PDFs.** Install [typst](https://github.com/typst/typst/releases). Eva then writes a PDF in `Scratch/` and sends it.
- **Voice notes.** Install [ffmpeg](https://ffmpeg.org/download.html) and [whisper.cpp](https://github.com/ggml-org/whisper.cpp), download a model (for example `ggml-base.bin`, which reads Spanish and English), and put it at `voice/ggml-base.bin` in Eva's home folder. The audio never leaves the computer.
- **Google (Calendar, Drive, Contacts, Tasks).** Eva uses your own OAuth client: an id and a secret that let her ask Google for access to your account. The Google part of **Settings** guides you, with a link for each step. It works on a phone, but only after a login with the token: a device login through Telegram cannot do it. First, install [uv](https://docs.astral.sh/uv/) on Eva's computer. The Google tools run with it. Then follow the steps in Settings:
  1. Make a Google Cloud project, and turn on the Google APIs.
  2. Set up the consent screen, and publish the app, so that its status is "In production". In "Testing", the login ends after 7 days.
  3. Make an OAuth client of type "Desktop app". Paste its client id and client secret into Settings.
  4. Press **Start the Google login**, open Google's page, and press **Allow**. Your browser then opens an address that does not load. Copy that address into Settings, and press **Finish**.

  Press **Test Google**. It reads each service, or names the step to fix. Then press **Restart Eva**, so that conversations use Google.

  `eva doctor` shows whether the login still works. Eva starts with read-only access. To let her add events, set **Google access** to "Read and change", and log in to Google again. She asks you before any change that reaches other people, such as an invitation. The Google tools work with Claude Code and with pi.
