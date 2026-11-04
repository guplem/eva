# Eva reference

Every command and setting, for when the [README](../../README.md) is not enough. In Telegram, type `/` to see every command. On a computer where Eva runs from source, type `bun run eva` where this page says `eva`.

## Commands

Run these on the computer where Eva runs. Eight commands need Eva to run: `status`, `link`, `open`, `devices allow`, `chat`, `projects`, `work` and `vault-upgrade`. The other commands also work when Eva is stopped.

| Command                           | What it does                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eva setup`                       | Asks each question again. Enter keeps the current answer.                                                                                                                           |
| `eva setup --non-interactive`     | Reads each answer from an `EVA_*` variable, for scripts.                                                                                                                            |
| `eva doctor`                      | Checks the tools that each feature needs, and says how to install each one.                                                                                                         |
| `eva`                             | Runs Eva in this terminal (the service does this for you).                                                                                                                          |
| `eva service install`             | Starts Eva now, by herself each time you log in, and again after a crash.                                                                                                           |
| `eva supervise`                   | Runs Eva, and starts her again after a crash (the start at logon on Windows does this for you).                                                                                     |
| `eva status`                      | Starts with "All good" or the problems, then the running process, sync, updates, local page, phone address, tool versions and Telegram pairing code. Says so when Eva does not run. |
| `eva link`                        | Shows the address that opens Eva on your phone and other computers.                                                                                                                 |
| `eva open`                        | Opens Eva in this computer's browser, already logged in, with no code or token.                                                                                                     |
| `eva devices allow <code>`        | Allows the device whose page shows this code.                                                                                                                                       |
| `eva chat`                        | Talks to Eva in this terminal. Type `/rename <title>` to name the chat, `/exit` to leave.                                                                                           |
| `eva chat --project <id>`         | Talks to a project's coding agent, or to a general project or a specialist in its folder. `--clone <name>` picks the copy of the code, such as `clone-0`, when it has no open chat. |
| `eva chat --model <model>`        | Picks the model: `smart`, `balanced` or `fast`. Without it, the model from the settings.                                                                                            |
| `eva chat --engine <engine>`      | Picks the engine: `claude-code` or `pi`.                                                                                                                                            |
| `eva projects [words]`            | Searches your projects. `status:<status>`, such as `status:in-use`, `status:current` or `status:any`, and `tag:work` filter them. `"#work"` works too, with the quotes.             |
| `eva work <project> <request>`    | Gives work to a project; a coding agent does it in a free copy of the code, or a chat in the project folder.                                                                        |
| `eva sync`                        | Gets other computers' notes, then saves and pushes this computer's notes.                                                                                                           |
| `eva update [version] [--check]`  | Installs what the policy allows, or the version given. `--check` only looks.                                                                                                        |
| `eva hub`                         | Makes this computer the hub, which runs Telegram and the reminders.                                                                                                                 |
| `eva vault-upgrade <step>`        | The steps of a [vault structure upgrade](#vault-structure): `start`, `finish`, `drop` or `undo`. The Assistant runs them; you can ask it in plain words.                            |
| `eva settings`                    | Lists every setting; `(vault)` marks the settings that every computer shares.                                                                                                       |
| `eva settings get <key>`          | Shows one setting, such as `updates.frequency`.                                                                                                                                     |
| `eva settings set <key> <value>`  | Changes one setting, such as `eva settings set updates.frequency weekly`.                                                                                                           |
| `eva version`                     | Shows Eva's version.                                                                                                                                                                |
| `eva help`                        | Shows every command.                                                                                                                                                                |
| `eva --instance <name> <command>` | Runs the command for the Eva with this name, as `EVA_INSTANCE=<name>` does. Without it, `eva` asks which Eva, or uses the only one.                                                 |

In Telegram, type `/` to see these commands, each with a short note:

| Command             | What it does                                                                  |
| ------------------- | ----------------------------------------------------------------------------- |
| `/new`              | Starts a new chat in a topic of its own.                                      |
| `/chats`            | Continues a chat from the web page or the terminal here: see [Chats](#chats). |
| `/rename <title>`   | Renames this chat and its topic.                                              |
| `/stop`             | Stops Eva's work in this chat.                                                |
| `/delete`           | Deletes this chat everywhere, with its topic.                                 |
| `/status`           | Shows Eva's state: "All good", or the problems.                               |
| `/projects [words]` | Searches your projects, as `eva projects` does.                               |
| `/schedules`        | Lists the schedules.                                                          |
| `/link`             | Shows the address that opens Eva on any device.                               |
| `/sync`             | Syncs the vault now.                                                          |
| `/conflicts`        | Picks a version of each note in a vault conflict.                             |
| `/update`           | Checks for updates, or picks a version of Eva.                                |
| `/logs [count]`     | Shows the last warnings and errors, 20 by default.                            |
| `/restart`          | Restarts Eva, after you confirm.                                              |
| `/help`             | Shows the commands.                                                           |

## Settings

Eva keeps her settings in two places, and her tokens in a third:

- **Your settings live in your vault,** in `.eva/settings/settings.json`, so every computer with the vault uses the same ones.
- **This computer's settings live in Eva's home folder** (`~/.config/eva-<name>` on Linux, `%APPDATA%\eva-<name>` on Windows, where `<name>` is the name of this Eva), in `config.json`.
  - **The settings that decide who may open Eva, and what an agent may do, are always computer settings.** The table marks them "(security)". Eva's AI agent edits the vault as part of its work, so these never live there.
- **Tokens live in `secrets.json`** in Eva's home folder, never in the vault: `githubToken`, `telegramBotToken`, `claudeOauthToken`, `localApiToken`, `googleOauthClientId` and `googleOauthClientSecret`. Eva also keeps there the key of her web push notifications, which she makes by herself.

In the vault:

| Setting                        | Default        | What it does                                                                                                                                         |
| ------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `timeZone`                     | Asked at setup | The time zone of the reminders, and of the time in each message.                                                                                     |
| `language`                     | Asked at setup | The language of Eva's answers, such as `Spanish`.                                                                                                    |
| `units`                        | From setup     | `metric` or `imperial`. `null`: not set.                                                                                                             |
| `clock`                        | From setup     | `24h` or `12h`: the form of each time that Eva writes and shows. `null`: 24-hour.                                                                    |
| `weekStart`                    | From setup     | The first day of the week, `monday` to `sunday`. `null`: Monday.                                                                                     |
| `sync.pullIntervalMinutes`     | `5`            | Minutes between two fetches of other computers' notes. `null`: only before each chat turn.                                                           |
| `sync.sweepSeconds`            | `60`           | Seconds between two saves of changed notes.                                                                                                          |
| `updates.frequency`            | `daily`        | How often Eva looks for a new version: see [Updates](#updates).                                                                                      |
| `updates.install`              | `minor`        | What Eva installs by herself: see [Updates](#updates).                                                                                               |
| `widgets.checkIntervalMinutes` | `30`           | Minutes between two update checks of your own widgets, 5 at least. Other widgets: once a day.                                                        |
| `engines.default`              | `claude-code`  | The engine of a new chat: `claude-code` or `pi`.                                                                                                     |
| `engines.defaultModel`         | `opus`         | The model of a new chat: `opus` (Smart), `sonnet` (Balanced) or `haiku` (Fast).                                                                      |
| `engines.defaultEffort`        | `medium`       | The effort of a new chat: `low`, `medium`, `high`, `xhigh` or `max`.                                                                                 |
| `engines.pi.models.<model>`    | `null`         | The pi model of each of the 3 tiers, such as `openai/gpt-5`. `null`: pi's own default. In Settings, the field suggests the models of your pi logins. |
| `google.email`                 | `null`         | The Google account. The Google login sets it.                                                                                                        |
| `voice.language`               | `null`         | The language of voice notes, such as `es`. `null`: whisper finds it.                                                                                 |

On this computer:

| Setting                                              | Default                                    | What it does                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vaultPath`                                          | `vault` in Eva's home folder               | The vault folder.                                                                                                                                                                                                                                |
| `machineName`                                        | The computer's name                        | This computer's name in `.eva/hub.json`.                                                                                                                                                                                                         |
| `port`                                               | `7420`                                     | The port of the web page on this computer: the number at the end of its local address.                                                                                                                                                           |
| `projectRoots`                                       | `[]`                                       | More folders of projects, beside `Projects/` in the vault.                                                                                                                                                                                       |
| `sync.enabled`                                       | `true`                                     | `false` stops the automatic vault sync on this computer, and the status says so. "Sync now" still works.                                                                                                                                         |
| `engines.claudeCode.executable`                      | `null`                                     | The program that starts Claude Code. `null`: `claude`.                                                                                                                                                                                           |
| `engines.pi.executable`                              | `null`                                     | The program that starts pi. `null`: `pi`.                                                                                                                                                                                                        |
| `engines.claudeCode.permissionMode` (security)       | `auto`                                     | How a Claude Code chat asks before an action. `auto`: Claude Code asks only about risky actions. `bypassPermissions`: every action runs with no question, Eva's own approvals too. A repository that Eva does not trust always uses `auto`.      |
| `telegram.allowedChatId`, `telegram.allowedUserId`   | Set when you pair the chat                 | The Telegram chat, and the person in it who may act.                                                                                                                                                                                             |
| `git.name`, `git.email`                              | `null`                                     | This Eva's commit name and email. `null`: the GitHub account's, then your git settings.                                                                                                                                                          |
| `trust.trustedRepositoryOwners` (security)           | `[]`                                       | More GitHub owners whose repositories Eva trusts at once. Their own agent settings then apply. Eva trusts her own GitHub login without it.                                                                                                       |
| `google.services` (security)                         | `calendar`, `drive`, `contacts`, `tasks`   | The Google services that Eva may use. `gmail` is the fifth choice. Tick them on the Google card.                                                                                                                                                 |
| `google.access.<service>` (security)                 | `readonly`                                 | The access level of each service. Calendar, Drive and Contacts take `readonly` or `full`. Tasks also takes `manage`, which cannot delete. Gmail takes `readonly`, `organize`, `drafts`, `send` or `full`. Log in to Google again after a change. |
| `voice.modelPath`                                    | `voice/ggml-base.bin` in Eva's home folder | The whisper.cpp model. Voice notes stay off without it.                                                                                                                                                                                          |
| `voice.vadModelPath`                                 | `null`                                     | A whisper.cpp model that finds the silence, so that whisper skips it.                                                                                                                                                                            |
| `voice.whisperExecutable`                            | `whisper-cli`                              | The whisper.cpp program.                                                                                                                                                                                                                         |
| `voice.ffmpegExecutable`                             | `ffmpeg`                                   | The ffmpeg program.                                                                                                                                                                                                                              |
| `remoteAccess.tailscaleServe`                        | `true`                                     | Publishes the web page to your Tailscale devices at start.                                                                                                                                                                                       |
| `remoteAccess.allowedTailscaleIdentities` (security) | `[]`                                       | The Tailscale accounts that may ask for a device login. `[]`: only the owner of this computer.                                                                                                                                                   |
| `remoteAccess.hostNames`                             | `[]`                                       | More host names that reach the web page, beside `127.0.0.1` and the Tailscale name.                                                                                                                                                              |

Change a setting on the web Settings page, or with `eva settings set`. The update frequency, the update policy, the vault fetch, the widget check interval, the trusted repository owners and the formats (`language`, `units`, `clock` and `weekStart`) apply at once: a new chat and the web page use them. Any other change applies at the next restart.

- **Tokens:** log in to GitHub and Claude Code on the Settings page, or paste their tokens there. Paste the Telegram token there too. The page never shows a saved token again. Press **Test** to check it. Then press **Restart Eva**, so that chats and the vault sync use it too. A card with a done login shows a green panel. Its **Log out** button removes the login, after a warning. Its **Log in again** button shows the steps again. A paired Telegram bot shows **Disconnect** and **Set up again** instead.
- **Test buttons:** each one makes a small, real check. The engine Test sends one tiny prompt, so it uses a little of your subscription.
- **A device that you allowed** has the same control as the terminal of Eva's computer: it can change every setting and token. If you lose a phone, tap "Log out every device" on the Settings page.
- **The guide:** **Settings > Guide** shows this page, the setup guide and [How Eva works inside](how-eva-works.md), with a search. A **?** beside a setting or an alert opens the guide at the part that explains it.
- **Theme, density and long file names** stay in each browser, so a phone and a computer can differ. A file name that does not fit on one line loses its middle, unless you pick its start or its end in **Settings > Personalize**.

## Several computers

Eva works on several computers with one vault, with no role to set.

- **The hub** is the one computer that runs the Telegram bot and the reminders. The first computer that starts with the vault becomes the hub. The vault names it in `.eva/hub.json`.
- **A satellite** is any other computer with the vault. It keeps the vault up to date and serves its own terminal and web page, but stays quiet in Telegram.
- **A computer with an older Eva** than the vault does not change the vault's settings, reminders or hub until you update it. Its web page shows a warning, and the hub sends it to Telegram.
- **Problems on a satellite** reach Telegram through the hub. Each computer writes its open problems to `.eva/machines/<computer>.json` in the vault, and the hub sends them. A vault sync problem cannot travel this way: it shows on that computer only.
- **A computer that is off** sends no news. When its report is more than one day old, its alerts say so, such as "laptop last reported 5 days ago".
- **A computer that no longer runs Eva** still has its file in the vault, and the hub keeps its alerts. Ask Eva in a chat to delete the file.
- **Move the hub** with **Make this machine the hub** on the Settings page, or `eva hub` on the new hub. The old hub stops its bot and reminders at its next vault fetch (5 minutes by default).
- **Two Evas on one computer** work too, one for each person: see [More than one Eva on a computer](setup.md#more-than-one-eva-on-a-computer).

## Updates

Eva looks for a new version every day by default (`updates.frequency`: `off`, `hourly`, `daily` or `weekly`). She installs it only when no chat is running, then restarts.

Each version has three numbers, `MAJOR.MINOR.PATCH`. A fix raises the last number, a new feature raises the middle one, and a change that can break something raises the first one. The update policy (`updates.install`) chooses what Eva installs by herself:

| Value             | Eva installs by herself                                       |
| ----------------- | ------------------------------------------------------------- |
| `patch`           | Fixes only.                                                   |
| `minor` (default) | Fixes and new features. She does not install a major version. |
| `major`           | Every release. A major version can break things that work.    |

The policy lives in the vault, so every computer follows the same one. When the policy does not install a newer version, Eva sends one Telegram message for it, and the status names it. When the vault needs a newer Eva than this computer runs, Eva installs at least that version, whatever the policy says.

- **Installed as one executable** (a GitHub release): Eva takes the newest signed release that the policy allows.
- **Installed from source** (`git clone`): Eva takes the newest version of `main`, and runs `bun install` when the dependencies changed. The policy does not apply. She never touches a copy with your own changes, your own commits, or another branch.
- **Check and install:** the **Check and install** button in Settings, `/update` then **Install** in Telegram, or `eva update`. Eva installs what the policy allows, at once.
- **Update to a version:** the **Update to a version…** button in Settings, a version button under `/update` in Telegram, or `eva update 1.2.0`. Eva shows what the update brings, breaking changes first. She never installs an older version.
- **Install a tool:** the **Versions** card in **Settings > Updates** has an **Install** button for each missing tool: Claude Code, pi, uv or gh. **Log in with GitHub** also installs a missing or old gh first.
- **Update a tool:** the same card shows the newest version of each tool when it is newer than yours, with an **Update** button. When Eva cannot read the newest version, the **Update** button stays. For Claude Code, Eva follows your update channel. Its **Update** button runs `claude update`, and shows the result under the table. Eva installs or updates one tool at a time, and only when no chat is running. A gh older than 2.40 shows as too old, because Eva's GitHub login needs a newer one.
- **Claude Code from a package manager:** if you installed Claude Code with a package manager, such as npm, update it with that tool.

## Vault sync

Eva saves the vault to GitHub by herself. [Settings](#settings) gives the default of each interval:

- She gets other computers' notes before each chat turn, and at the interval in `sync.pullIntervalMinutes`.
- She saves and pushes after each turn, and at the interval in `sync.sweepSeconds` when something changed.
- **Sync now:** the **Sync now** button in **Settings > Vault and sync**, `/sync` in Telegram, or `eva sync`.
- **Files that Eva does not save:** a file that holds a secret but is not a secret file, such as a `.env` with a token, and any file over 50 MB, because GitHub refuses files over 100 MB. `eva status` and the Settings page name them.
- **Encrypted files:** Eva encrypts each secret file before she saves it, such as `.env.local`, a `.pem` or a `.key` file. Your vault remote never gets its plain text. See [Encrypted files](#encrypted-files).

### Encrypted files

Your vault can hold secrets, such as API keys, but only encrypted. Eva encrypts each secret file before each save, in place, under the same name. An agent that opens it sees only her first line: "Encrypted by Eva. Open this file in Eva's Files page to read it."

- **The vault password.** Setup asks for it twice, for a new vault. For an existing vault, set it in **Settings > Vault and sync > Encrypted files**. It needs at least 12 characters. Nobody can recover it: keep it in a password manager. Until the vault has a password, Eva keeps each secret file on this computer and saves none of them.
- **Which files.** The defaults are `.env.local`, `.env.*.local`, `.env.secrets`, `*.secrets`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.npmrc`, `.pypirc`, `.netrc`, `secrets.json`, `credentials.json` and `client_secret*.json`. A plain `.env` and `.env.example` stay plain: keep only values that are safe to share in them. A plain `.env` with a key or a token stays out of each save, and the phone says so. A vault from before this feature keeps its plain `.env` files outside `Projects/` on each computer, as before: move a secret into a `.env.local` file to sync it.
  - The Settings card shows each default with a switch, and your own patterns, in `.gitignore` syntax, such as `Life/Health/**`. Eva keeps your changes in `.eva/secret-files` in the vault.
  - A new pattern encrypts its files at once. A pattern that you take out keeps its files encrypted until you confirm it from an unlocked device. Then Eva decrypts them, and your vault remote gets their plain text.
  - Eva never encrypts `.eva/`, any `AGENTS.md`, `.gitignore` or `.gitattributes`, so the Assistant always works. Keep no secret in those files. The secret patterns still apply inside `.eva/scratch/`: Eva refuses to send such a file there, and the Files page and the search mark it as secret.
- **Read a file.** Open it in **Files** on the web page and type the vault password. This browser tab can then open encrypted files for 8 hours, until you press **Lock**, or until Eva restarts. Eva decrypts only for a device that logged in with a code or a link, never with the token. Telegram never shows an encrypted file. A browser on Eva's own computer keeps its login and its unlock in your browser profile, where an agent that runs as you can read them: press **Lock** when you are done there.
- **Change the password** in the Settings card. Eva makes a new key for the new password and encrypts every file again, so the old password opens no file that Eva encrypted after the change. Each device must unlock again. Eva makes no change until a sync with the remote works, so a file from another computer does not stay on the old key. A file that another computer still put on the old key moves to the new key at the next unlock.
  - Old commits still hold the old key, and the old password opens them. So when you think someone knows the old password, also change the secrets in these files, such as an API key.
  - The old key signs the new one: it adds a proof that only the old key can make. So each other computer that shares the vault trusts the new key by itself after its next sync, with no question. An Eva from before this feature cannot read that proof, so update every computer first. A password change on such an older Eva also drops the older keys, so a file still on one of them stops opening.
- **A key that changed with no signature** of the key that a computer trusts stops new encryption on that computer. The phone asks you to confirm it in Settings. Your own password change always signs its key, so such a key may be someone else's. Do not confirm it unless you know why it changed, such as an older Eva that made it.
  - A limit: someone who knows the old password can also sign a key with the old key. A computer that has not synced your change yet would trust such a key. So after a leak, change the password at once.
- **Before an update of this feature,** a secret may already sit in old commits of the vault, on its remote and on each computer. Change such a secret. Update Eva on every computer that shares the vault.

### Vault conflicts

A conflict happens when two computers change the same lines of a note before they sync. Eva never deletes a change. She stops pushing, names the notes, and sends an alert.

To fix it from your phone:

1. Send `/conflicts` in Telegram, or open **Settings > Vault and sync** on the web page of the computer with the conflict.
2. For each note, tap one button:
   - **Keep mine:** keep this computer's version.
   - **Keep theirs:** keep the version that the other computer pushed.
   - **Keep both:** keep this computer's version, and put the other version in a copy beside the note, such as `Plan (conflict copy).md`.
3. After the last note, Eva pushes again by herself.

No pick loses a version. Git history keeps both versions of a note that was committed on both sides. An edit that was not committed yet stays in git's stash, which Eva never drops.

Only the hub runs Telegram, so `/conflicts` shows the hub's conflicts. For a conflict on another computer, open that computer's web page.

This needs git 2.38 or newer on the computer with the conflict. With an older git, the alert says so.

## Vault structure

The vault structure is how the folders and notes of your vault are organized. `.eva/vault-structure.json` records its version. A vault with no record follows version 2. An Eva update never changes the structure of your vault: it only tells you that a new one exists. The notification center shows a warning until you mark it as read or update the vault, and your phone gets one message. Its **Open Settings** button opens the card below. The first new Assistant chat after it can mention it too.

**Settings > Vault and sync > Vault structure** shows your version, the newest one, and what changes. To upgrade, press **Update the vault** there or under the Telegram message, or ask the Assistant. Only the hub upgrades the vault, and only with the automatic sync on. Eva's `vault-upgrade` skill then works with you, in one chat:

1. It reads your vault and plans each move, with no change yet.
2. It asks every question in one message: your own changes to the template files and where to keep them, where the facts of About me go, each deletion, the schedule changes, and where each git-ignored file goes. In yolo mode, it decides where each note goes by itself. Otherwise it shows the whole plan for your yes.
3. It makes a backup tag in git, such as `before-v3`, and pushes it. It pauses the sync on the hub and works on a branch, such as `upgrade-v3`. It moves each note with `git mv`, so the note keeps its history, and checks the result against a list of every file. Your _Personal rules_ section of `AGENTS.md` stays as it is.
4. After your yes, it merges the branch and records the version. Then the sync runs again. When a note changed on both sides, Eva keeps both versions, the other one in a copy beside the note.

Notes that other chats or your phone write during the upgrade are kept. Before the merge, ask the Assistant to drop the upgrade: the vault stays as it was. After the merge, ask it to undo the upgrade: the vault goes back to how it was before, with the notes written since.

## Problems and alerts

Eva sends each alert to your Telegram chat when the problem starts, again once a day while it lasts, and once more when it ends. The open problems also show on the web page, because Telegram itself can be the problem. Tap Eva's face in the menu to open the home page, then tap the bell at its top right to open the notification center. It lists each open problem with the button that fixes it, and what Eva told you in the last 30 days.

Press **Mark as read** on a problem to quiet it. It stays in the list, but Eva's face stops counting it, on every device that opens this Eva, until the problem becomes an error or ends. Eva sends no daily reminder for it, also when you mark it as read on another computer. `/status` still counts it. **Mark all as read** quiets every open problem at once.

From a phone: `/status` shows the problems and the version of Eva and each tool, `/logs [n]` shows the last `n` warnings and errors (20 by default), and `/restart` restarts Eva after you confirm. The Settings page has a **Restart Eva** button too. Its **Updates** section shows the version of Eva and each tool.

| Alert                                | When                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| The vault sync stopped on a conflict | Two computers changed the same note: see [Vault conflicts](#vault-conflicts).                                                |
| The vault sync failed                | A git step failed two times in a row, for example on a full disk or a refused push.                                          |
| The vault cannot reach GitHub        | The vault was offline for more than 30 minutes.                                                                              |
| The update check or install failed   | The checks failed for 2 hours or more, or an install failed. A failed install keeps the old version.                         |
| The Claude Code update failed        | The alert names the reason. Chats keep the old version of Claude Code.                                                       |
| A reminder failed to run             | The alert names the reminder.                                                                                                |
| Eva started after an unclean exit    | A crash or a power cut stopped her. Send `/logs`.                                                                            |
| Eva cannot read Telegram             | Another program uses the bot, or Telegram failed for over 15 minutes.                                                        |
| The vault sync is paused             | The vault is on another branch. Fix it, then send `/sync`.                                                                   |
| An engine login expired              | Chats with that engine fail. Log in again in **Settings > AI engines**.                                                      |
| An engine program is missing         | Chats with that engine fail. Press **Install** in **Settings > Updates**, then **Restart now**.                              |
| The vault needs a newer Eva          | This computer does not change the vault's settings, schedules or hub until you update Eva there.                             |
| A migration failed                   | The files stay as they were. Eva tries again at the next start.                                                              |
| Encrypted files need you             | No vault password, a key that changed, or a secret file that stays out of the save: see [Encrypted files](#encrypted-files). |
| Eva cannot save your location        | The header of `Life/About me.md` has a problem. Eva keeps the location until you fix it.                                     |
| A project shell can read the vault   | The sandbox of project chats does not work here: see [Set up the sandbox](#set-up-the-sandbox).                              |

A problem on a satellite shows on the hub too, with the name of that computer. Fix it on that computer.

## Notifications on a device

Eva can also tell a phone or a computer through the browser, with a system notification. This works also when Eva's page is closed.

1. Open **Settings > Access > Notifications on this device**.
2. Tap **Turn on notifications**, and allow them in the browser's question.
3. Pick when Eva tells this device:
   - **Eva answers:** her answer is ready, also at the end of a long task.
   - **A schedule finishes:** the chat of a reminder has its answer.
   - **Eva waits for your approval:** a tool call needs your yes or no.
   - **Problems and their fixes:** the alerts above. Only the hub sends them.

A tap on a notification opens its chat. Each device picks its own kinds.

Eva sends a device no notification while her page on that device is in view and in front. Eva sends no notification for her answer to a message that you sent from Telegram: Telegram shows the answer already. She sends none for a task that you stopped.

On an iPhone or an iPad, add Eva to the home screen first, then open her from there. Each computer of your vault sends the notifications of its own chats, so turn them on in the page of each computer that you use.

## Logging in to the web page

The first time a device opens Eva's page, the page shows a short code. Allow the device, and it stays logged in for a year:

| Where you allow it                                                                | Which devices                                                    |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `eva devices allow <code>` on Eva's computer, or the code question of `eva setup` | Every device                                                     |
| **Allow** in Telegram                                                             | A phone or another computer, not a browser on Eva's own computer |
| **Allow** on Eva's page on another logged-in device                               | A phone or another computer, not a browser on Eva's own computer |

A request from Eva's own computer can come from any program there, so only the terminal answers it.

- **Through Tailscale,** only the Tailscale account that owns Eva's computer can ask. To allow other accounts to ask, such as a partner's, list them all in `remoteAccess.allowedTailscaleIdentities`.
- **On the computer itself,** run `eva open`. It opens the page in that computer's browser, already logged in, with no code. Its login link works once, for 2 minutes, and only on that computer. The page listens at `http://127.0.0.1:7420` (or that Eva's port).
- **The last way in,** when nothing else works: the token `localApiToken` from `secrets.json` in Eva's home folder. On the page, press "Log in with the token instead", and paste it. Never share it.
- **Devices** in Settings lists each allowed device. Tap **Remove** to log out one, such as a lost phone, or **Log out every device**. A lost phone that is still logged in can allow new devices, so remove it at once.
- **Keep Eva off Tailscale:** to turn off her Tailscale address, run `eva settings set remoteAccess.tailscaleServe false`.

## Chats

- **One list.** Telegram, the web page and `eva chat` share the same chats.
- **Continue a chat in Telegram:** send `/chats` and tap the chat. It opens in a topic of its own (a thread inside your bot's Telegram chat), with its last 3 turns. The topic then also shows the messages from the web page and the terminal. Without topics, the main Telegram chat continues it.
- **Project work:** when Eva gives work to a project from Telegram, its chat opens in a topic. In a group, Eva sends the link to that topic. When Tailscale gives Eva an address, she also sends the link to the chat on the web page.
- **Delete a chat:** send `/delete` in its topic, or pick **Delete chat** in the "More actions" menu (•••) of the chat on the web page. Eva deletes it from Telegram, the web page and the terminal, with its forks. A fork is a new chat that copies an earlier chat up to one message, then continues on its own. The engine keeps its own transcript.
- **Rename or delete a branch:** a branch is the main line of a chat or one of its forks. Right-click the branch, or press and hold it on a phone. Do this in the chat list or in the branch map of the web page. A branch that you did not name shows as "Main line", "Fork 1", "Fork 2", and so on.
- **Delete fork** deletes only that branch. Its forks stay, with their whole history. The oldest fork that shares its history takes its place. When the main line goes, that fork becomes the main line. The chat keeps its title and its Telegram topic.
- **Message actions:** right-click a message on the web page, or press and hold it on a phone. Your messages show **Copy**. Eva's answers show **Copy**, **Retry** and **Fork**, the same as the buttons under the answer. A right click on selected text or on a link shows the browser's own menu. On a phone, a press and hold opens Eva's menu instead of a text selection.
- **Open one chat on the web page:** add `#/chat/<id>` to the address. Telegram sends such links.
- **Engine, model and effort:** tap the chip in the message box of a web chat to pick the engine (Claude Code or pi), the model (Smart, Balanced or Fast) and the effort of this chat. A new chat uses the defaults from [Settings](#settings).
- **Stop a turn:** while Eva works, the **Send** button becomes **Stop**. In Telegram, send `/stop`. A message that you send while Eva works waits in line, and goes in her next turn.
- **Rename or archive a chat:** pick **Rename** or **Archive** in the "More actions" menu (•••) of the chat, or right-click the chat in the list. **Unarchive** brings an archived chat back.
- **Start over from a summary:** a long chat can confuse the model. Pick **Start a new chat from a summary** in the "More actions" menu. Eva writes a short summary, and a new chat starts from it.
- **See what a chat knows:** the details of a chat show its **Context**: Eva's prompt, your rules, the pinned files, the instruction files, the skills and the text that each turn adds. Tap a part to read it. Eva shows each part as it is now, so a running chat can still use an older copy. **Context used** shows how full the model's memory of the chat is.
- **Fork a chat:** press **Fork** under an answer on the web page. The fork copies the chat up to that answer, then continues on its own. For a project chat, see the choices in [Projects](#projects).
- **Retry an answer:** press **Retry** under it on the web page. The new answer goes in a new branch, and the old answer stays. When the answer, or a later one, changed vault files, Eva asks first:
  - **Undo and retry** puts those files back as they were before the answer, and saves that as a new commit.
  - **Keep and retry** does not change them.

  Eva restores only files: a sent message or a calendar event stays. A file that changed after the answer stays too, and so does a file that Eva does not save in git, such as a file in `.eva/scratch/`. The question names them. With the vault sync off, Eva does not ask.

- **pi chats:** a pi chat with Eva asks you questions with the same form as Claude Code. A pi project chat stays as pi is. pi keeps the history of each chat in a file in Eva's folder. When that file is gone, the chat goes on as a new conversation, and Eva tells you and the model.

## Projects

- **Create a project:** open **Projects** in the web app and tap **New project**. Pick the project type: **General**, **Software** or **Specialist** (see _General projects_ and _Specialists_ below). Give a name, a short description, a status and tags. Eva makes the folder `Projects/<date>-<time>-<name>/` in the vault, with its `AGENTS.md`. The steps below are for a software project only.
  - Tick **Create a GitHub repository** to get a repository in your GitHub account. It takes the folder name without the date and time.
  - Pick its type. **Standard** gets a first commit and the security items that GitHub offers. **Vibe-coded** follows the [vibe-coded standard](../vibe-coded-standard.md): Eva sets up what she can, then opens a project chat for the rest. That chat merges its own pull request. **Widget** makes a widget for Eva's home page from Eva's template, as the [widget contract](../widgets.md) says: Eva pushes the template, turns on GitHub Pages for its demo, and opens a project chat where you say what the widget does.
  - Pick **Private** or **Public**. A widget is public by default. A private vibe-coded repository uses the CI minutes of your GitHub account, and some guards of the standard need a paid plan. A private widget has no GitHub Pages demo on a free plan.
  - Tick **Create a Google Drive folder** to get a folder in your Drive. It needs the Drive access "Read and change", in **Settings > Connections > Google**.
  - When one of these steps fails, the project stays. The form says what failed, so you can do that step by hand.
- **Status:** each project has one status. **Active** is a project that you develop. **In use** is a project that you use now, such as a project that makes the week's menus. The other statuses are **Idea**, **Paused** and **Closed**.
  - The details form writes the dates of the status. When an idea becomes active, it writes `started:` with today. When a project closes, it asks for the day and writes `closed:`. A project that opens again loses `closed:`.
  - The Projects page opens with the **Current** filter: the active and in-use projects. Tap a status to see only that status. With no project open, a computer shows the chats that need you, your recent chats, a timeline of your projects, and the count of each status in a year. At first, the timeline shows the active and paused projects. Tap a status above it to add or remove that status. Tap a count to filter the list. A phone shows the chats that need you above the list. **Projects**, beside the title of a project, brings you back. In the search, in `eva projects` and in Telegram's `/projects`, type `status:in-use`, `status:current` or `status:any`. Add `tag:work`, or `#work` in Telegram, to see only the projects with that tag.
  - Each new chat with Eva pins your active and in-use projects, with the title, the folder and the summary. So Eva knows them without a search. See [Pinned files](#pinned-files).
  - The **New project** form writes the first paragraph of the description as the project's `summary:`. The project page shows it.
- **Project card:** the top card of the project page shows each key of the front matter of `AGENTS.md`, also a key that you add, such as `deadline:`. Each key shows as a name, such as "Deadline". A date shows in the language of your browser, and a time follows the clock of your settings. A link names its site, such as GitHub or Figma.
- **Repository setup:** open it from the project page. It checks each repository by its type. A repository with no type, such as one that you added by hand, shows no report: pick its type first.
  - **Fix** on an item that a command can fix runs it on GitHub at once. Press **Refresh** to see the item turn green. Any other **Fix** opens a chat with the request.
  - A file fix, such as a skill copy, goes straight to the default branch. When the branch requires checks, Eva opens a pull request with auto-merge instead. It merges by itself when CI passes, and the item turns green then.
  - **Fix all** runs every fix that a command can do. Then it opens one chat for the rest, when something is left.
- **General projects:** a general project is a folder of notes and files with no code, such as building a house, a scale model or a book. A project with no `type` and no `repos` is general. A project with `repos` and no `type` stays software.
  - Its chat starts in the project folder and works like a specialist's chat, below, but with no rules of its own. A new general project opens its page, not a chat. It can have a Google Drive folder, but no repository and no clone.
  - General and specialist switch in **Details** at any time. A change to or from software waits until the project has no chats and no clones.
  - A general project must be in the vault's `Projects/` folder. The project page shows a warning for a general project outside the vault, with `repos`, or with a clone on this computer. Write `type: general` before you add `repos` to a project with no `type`: the `repos` alone make it software.
  - In the chat header, the Mode line and Telegram's chat list, its chat is a "Project" chat.
- **Specialists:** a specialist is a project that you chat with directly, such as a gym coach. It has its own rules and memory. Its `AGENTS.md` has `type: specialist` in the front matter.
  - The text under the front matter holds the rules of the specialist. Its memory and its other files sit beside the file. At your first message, a new specialist asks what it does. Then it writes its rules into this file.
  - A chat with a specialist starts in its project folder. It reads only the project's `AGENTS.md`, not the vault's, and gets no prompt or skill of Eva's. So it does not know that it runs inside your vault.
  - Eva syncs the vault around each of its turns, so a file that it writes reaches your other computers. Its hooks and Claude Code's own memory are off: it keeps its memory in its folder.
  - It has no clones and no repository. A fork or a retry stays in its folder. A retry can undo the files that the chat changed, as in a chat with Eva. It takes no `@` mentions.
  - A file that you send to its chat lands in `.eva/scratch/received/<project-id>/`, not in the project folder. The chat can read it, but not change it. Ask the chat to copy a file worth keeping into the project folder: the copy in `.eva/scratch/` goes after a week.
  - A specialist must be in the vault's `Projects/` folder. The type changes in **Details**: to general at any time, to software only while the project has no chats and no clones. The project page shows a warning for a specialist outside the vault, with `repos`, or with a clone on this computer.
  - In Telegram, the chat list names it "Specialist".
  - A specialist runs with your own permission mode, as a project chat does, but its folder is in your vault. Retry with undo takes back what it changed.
  - It cannot open the rest of the vault: see [What a chat can reach](#what-a-chat-can-reach).
- **Clones and chats:** a clone is a copy of every repository of a project, in `Projects/<project>/repos/clone-<n>/`. Each repository has its own folder inside it. A project chat starts in the clone folder, so the agent sees every repository. It loads the project's `AGENTS.md`, and one line that Eva keeps in `repos/AGENTS.md`: the project's notes are two folders above the clone. Eva rewrites that file only while its first line is her marker, so a `repos/AGENTS.md` that you write stays as it is. A clone chat then gets no line about the notes. The sync never saves a file of `repos/`, even when the vault's `.gitignore` does not list it. An extra project root that is a git repository of its own needs the line `*/repos/` in its `.gitignore`. It loads no instruction file above the project folder, such as the vault's `AGENTS.md`. So the chat does not know that it runs inside your vault. Claude Code reads hooks, `.claude/settings.json` and `.mcp.json` only in its start folder. So it loads none of them from a repository. Git hooks still run.
- **Clone cards:** the project page shows each clone, with its repositories, their branch and their changes. **New clone** makes another copy. **Pull** updates a repository from GitHub, and **Pull all** updates every repository that is behind. **Push** commits every change with your note as the message, then pushes the branch. Leave the note empty, and a model writes the message. **Delete clone** removes a clone.
- **The file wall:** a project chat cannot open your vault, your other project folders or Eva's own folder. Mention a file to give it a copy. See [What a chat can reach](#what-a-chat-can-reach).
- **New chat:** tap **New chat** on the project page. Eva picks the clone. A clone has one chat and its forks. Eva reuses a clone only when three things are true:
  - All its work is on GitHub.
  - No turn runs in it.
  - A small model says that its chat has finished.

  Eva then closes the old chat. You can read it, but it takes no new message. She puts each repository on its default branch, up to date with GitHub. The installed dependencies stay. When no clone is free, she makes a new clone.

- **Retry and fork:** before and after each turn of a project chat, Eva keeps a snapshot of the files of the clone. The snapshot holds every file that git does not ignore. **Retry** under an answer asks:
  - **Undo and retry here:** the files go back to how they were before that answer. Every later answer is undone too.
  - **Retry here:** the files stay as they are.
  - **Retry in a new clone:** a new clone gets the files from before that answer. The old clone stays, so you can compare the two tries.

  **Fork** asks:
  - **New clone at this answer:** a new clone gets the files as they were at that answer.
  - **New clean clone:** a clone on the default branch, up to date with GitHub.
  - **This clone:** the fork shares the files with its chat. Their turns run one after the other.

  A retry or a fork in a new clone is the first chat of that clone. A note at its top names the chat and the clone that it came from. When Eva cannot copy the chat to the new clone, the new chat starts from a summary. Read the summary, then send it. Ignored files, such as installed dependencies or `.env`, stay as they are after a restore. An undo keeps the files as they were just before it in one more snapshot. A commit that is already on GitHub stays there, so a later pull can restore it. An answer from before Eva kept snapshots offers only the choices that need none.

- **Trusted repositories:** a project chat uses the project's own agent settings and tools (the hooks, settings and MCP servers of its clone) only when Eva trusts every repository in it. Eva trusts the repositories of the GitHub account that she logs in with. She also trusts the owners in `trust.trustedRepositoryOwners`. She asks about any other repository once, and keeps your answer. **Settings > Trusted repositories** lists the trusted accounts and the saved answers. Add or remove one there. A change applies to the next project chat.
- **What Eva may do:** **Settings > AI engines > What Eva may do** lists, for each engine and each kind of chat, what runs with no question, what Eva asks you first and what never runs. See also [What a chat can reach](#what-a-chat-can-reach). It also lists your own Claude Code `allow`, `ask` and `deny` rules apart, with the file that holds them: the `settings.json` in this Eva's Claude Code folder, and `.claude/settings.json` in your vault.

## Pinned files

Eva knows some files in every chat with no search. At the start of each new chat, she builds a pinned block from the front matter of your files:

- `summary:` is one line that says what the file holds.
- `pinned: full` puts the whole file in the block. Keep such a file short.
- `pinned: summary` puts the file's path and its summary in the block.
- `pinned: false` keeps the file out of the block.
- With no `pinned:` value, the status decides. Your active and in-use projects, your open and waiting cases (`Life/Cases/<folder>/Case.md`) and your open period (`Life/Periods/<folder>/Period.md`) each get a summary line.

How the block works:

- **Order and limits.** The `full` files come first, then the `summary` files, each by path. Then come the cases with a mark, the other cases, the period and the projects. The block holds about 25 summary lines and about 2,000 tokens of full text. A full file that does not fit shows as its summary line, or as its path with "(open it when needed)". A project outside `Projects/`, in `projectRoots`, always shows as a summary line, also with `pinned: full`. Over a limit, the block ends with "N more not shown", and Eva offers which files to unpin.
- **Marks on a case or a project.** `DUE` means that the case's `next` date has come. `DEADLINE` means that its `deadline` is 14 days away or less, or has passed. A closed project gets no mark. Eva counts the days in your time zone.
- **Data, not orders.** A full file sits between markers that name its path, and Eva reads it as facts about you. Its front matter shows with no comments, no empty keys and no `lastLocation`.
- **Safe.** The block never holds a secret file, an encrypted file, a link, a file in `.eva/`, in the old `Scratch/` folder, in a `node_modules` folder or in a project's clones. A full file that holds a key or a token shows only as its summary line.
- **Fixed for the chat.** A change to a pinned file shows in the next new chat. The chat details show the block under **Your pinned files**. A project chat gets no block.
- **Older vaults.** An update of Eva gives each project of `Projects/` a `summary:` with its first paragraph. A note with a `> Important: <why>` line under its title gets `pinned: summary`, and the reason becomes its summary.

## What a chat can reach

An AI agent in Eva runs as your user on Eva's computer. This part says what each kind of chat can read, change and run. It also says where the protection is weak.

### Assistant chats

A chat with Eva has no wall.

- It reads and changes every file of your user: the vault, your other folders and Eva's own folder.
- It runs any program that your user can run. It reaches any website.
- It cannot do the work of an administrator, unless `sudo` asks your user for no password.
- Two things stop a risky action. In Auto mode, Claude Code's safety check refuses some actions. Eva also asks you first before some actions, such as a push or a message to other people. **Settings > AI engines > What Eva may do** lists them.

The Assistant needs the whole vault and the `eva` command. So Eva puts no wall around it.

### The file wall of a project chat

A project chat works in its own folder: its clone folder, or the project folder of a general project or a specialist. A chat in a clone also reads, but never writes, its project folder. A chat in a project folder also reads, but never writes, the files that you sent to its project. The wall closes these folders to it:

- your vault,
- your other project folders,
- Eva's own folder, with her logins and secrets,
- the folder of Eva's own Tailscale, if she installed it for your user: a command could open a public tunnel with it.

So a chat in a clone reads the notes of its project. It opens a secret file there too, such as a `.secrets` file: once Eva has saved the file encrypted, the chat sees only the encrypted text. It cannot read the other clones of the project or any other note. To give it another vault file, mention the file. Eva then puts a copy in the clone. The other files of the computer stay open.

The wall has two parts.

**The file tools.** Before each read, write or search, Eva checks the path. A path in a closed folder gets the answer "This path is outside this chat's folder." So does a write to the project folder of a clone chat, and any tool there that Eva does not know as a read, such as an MCP tool. This works in every permission mode, and with both engines. A clone chat can list its whole project folder, such as with pi's `ls`. A file search of the whole folder is refused, a Glob too, since the folder holds the other clones. The answer then says to search a sub-folder, or to list the notes with the shell. A search of the shell skips the other clones. A file tool also cannot write some files of the chat's own folder: its `.claude` or `.pi` settings, its `.mcp.json`, and a `.git` folder. Such a file could run code at the next turn.

**The shell, in a sandbox.** A sandbox is a box that the system builds around a program. Claude Code has one, and Eva turns it on for each project chat. Inside the sandbox, the closed folders look empty or missing. So every program fails to read them, not only `cat`. On Linux the message is "No such file or directory". On macOS it is "Operation not permitted".

In the sandbox, a command:

- runs any program, such as git, node or python;
- installs packages for the project, such as with `npm install`;
- writes only in the chat's folder, the temporary folder and npm's cache;
- cannot install a program on the computer or change your settings, and cannot use `sudo`;
- reads the git config and the GitHub login, so `git commit` and `git push` work;
- cannot use git over SSH: the sandbox lets a command out to the internet only through its own proxy, for web addresses. So use an `https` address, not an `ssh` one, for a git repository;
- reaches the git hosts and package sites: GitHub, GitLab, Bitbucket, npm, Yarn, PyPI, crates.io, Go and Maven. For any other site, Claude Code's safety check decides in Auto mode. In Bypass mode, every site is open;
- cannot reach Eva herself by the names `localhost` and `*.ts.net`, on this computer or on your tailnet (your private Tailscale network). A number address, such as `100.64.0.1`, is not blocked;
- can serve on a port of this computer, such as for a dev server.

pi has no sandbox. Its file tools stay walled, but its shell can read the closed folders.

### The socket filter

A socket is a private door between two programs on the same computer. Docker, systemd and `ssh-agent` each have one. Through some of them, a command could ask a program outside the sandbox to read the closed folders.

On Linux, Claude Code adds a filter to the sandbox that closes every socket. To work, the filter builds a second sandbox inside the first one. Ubuntu 24.04 and later do not allow that: their setting `kernel.apparmor_restrict_unprivileged_userns` blocks it. There, the filter would break every command, even `echo`.

So at start, Eva tries a sandbox inside a sandbox:

- **While the test runs,** Eva treats the filter as off. The known socket folders stay closed.
- **Where it works,** Eva keeps the socket filter on.
- **Where it fails,** Eva turns the filter off, so each command still runs. Instead, she closes the folders where the known sockets live: all of `/run` (but the name server file), your user's runtime folder, the screen's, and the folders of Docker Desktop, Rancher Desktop, Colima and Lima in your home folder. The vault and the other closed folders stay closed.

Without the filter, the wall is weaker: Eva's list can miss a socket in another folder. Do not turn off Ubuntu's setting for Eva. It protects the whole computer.

### Set up the sandbox

- **Linux:** the sandbox needs `bubblewrap` and `socat`, two small programs that build the sandbox. The one-command install adds them. For an Eva from before, run the install command again, or run `sudo apt install bubblewrap socat`. Then restart Eva.
- **macOS:** the sandbox needs nothing.
- **Windows:** Eva has no sandbox to turn on. The shell of a project chat can read the closed folders. Eva tells you this once, in the notification center. The file tools stay walled.

At start, Eva tries the sandbox. When it cannot start, a notice says why. The chats still run, and their file tools stay walled.

### Limits of the wall

The wall stops an agent that makes a mistake or looks around. It does not stop an agent that tries hard to get out:

- **GitHub:** the shell reads the GitHub login, so that `git push` works. Your vault is on GitHub too, so a command can download it from there.
- **Sockets:** where the socket filter is off, a socket that Eva's list misses can let a command run code outside the sandbox. An example is the socket of `ssh-agent` (the program that keeps your SSH keys) in the temporary folder.
- **Programs outside the sandbox:** MCP servers and the hooks of a trusted clone run outside it.
- **pi and Windows:** the shell has no sandbox there.
- **Another Eva:** the wall closes this Eva's folder only. Another Eva on the same computer stays open.
- **Assistant chats:** they have no wall at all.

Some commands work differently in the sandbox:

- `git push -u` cannot save the upstream branch, because the sandbox protects `.git/config`. Use `git push origin <branch>`.
- Cargo, Gradle and Maven cannot write their caches in the home folder. pip, uv, Go and the other tools keep their caches in the temporary folder.

## Optional features

Each feature stays off until you set it up. `eva doctor` shows which tools are missing.

- **Reminders and repeated tasks.** Ask Eva for a reminder or a daily summary, or open **Schedules** in the web app. A schedule runs at a time on some days of the week, every few hours, days or weeks from a first run, or once at a date and time. Eva keeps them in `.eva/schedules.json` in the vault, and only the hub runs them. When a chat adds or changes a schedule, Eva asks you first.
  - A new or changed schedule runs at its next time. A change to a time that just passed waits for the next one.
  - A schedule sends a text, sends a vault file, or runs a prompt. A prompt starts a new chat, named after the schedule, and can pick a model.
  - The Schedules page shows what runs today, when each schedule repeats, and how its last run went. Use the switch of a schedule to pause it. Tap the pen to change it: its history stays. `/schedules` in Telegram lists them.
  - A one-off that Eva misses because she is off runs when she is back. When it comes an hour or more late, a line says so. After its run, it shows as "Ended". To run it again, give it a new date.
  - Ask "tell me when the bank replies" to get a watch. A watch is a schedule that checks, for example once a day, until a last day. A run with nothing new stays quiet. It sends no message and no notification, and Eva deletes its chat. The Schedules page shows "No news" for it. The run that finds the reply sends it, and then the watch ends. The page shows it as "Ended". Turn it on again to watch again.
  - A watch works with two marker lines that the agent writes in a scheduled run. `[[quiet]]` means "nothing to tell", and `[[done]]` means "the watch is over". Each schedule that repeats can also have a last day (`until`, "Last day" in the form). The last day still runs. After it, the schedule does not run, and the page shows it as "Ended".
- **Eva's rules.** Your rules for Eva set her tone, how she answers and how proactive she is. Read and change them in **Settings > Personalize > Eva's rules**, or ask Eva to change them. They live in `.eva/assistant.md` in the vault.
  - They apply to each chat with Eva, in Telegram, on the web page and from a schedule, from the next new chat. A project chat never uses them. It uses the harness's own prompt and the instruction files of the project and its repositories, such as `AGENTS.md`. It never loads the vault's instruction files.
  - Eva's built-in rules come first and say how Eva works, such as how she answers from your notes, how she learns, and how she gives work to a project. The page shows them, but only an update of Eva changes them. Where the two disagree, your rules win.
  - **Restore the default** replaces your rules with Eva's short default rules: a Style section and a Behaviour section. It first offers to save your old rules in a backup file in `.eva/`.
  - Eva's own skills ship with Eva, so each update brings their newest version: `eva-issue`, `eva-rules`, `about-me`, `schedule` and `vault-upgrade`. Your own skills live in `.eva/skills/` in the vault. A skill there with the name of one of Eva's skills replaces it.
- **Chat names.** A chat takes the first line of its first message as its name. To name chats your way, write rules in **Settings > Personalize > Chat names**, or ask Eva to, such as "Lead every name with an emoji". After the first answer, a small AI call with your engine login names the chat by your rules. Your own rename always wins.
- **Text actions and saved prompts.** Tap the command button (a slash in a square) in the message box of a web chat to open its menu.
  - A text action, such as **Polish**, asks a model to rewrite the text in the box. It sends nothing. The model sees only that text. **Undo** brings back your text.
  - A saved prompt, such as **Summary**, puts its text at the cursor.
  - Change them in **Settings > Personalize > Message box menu**, or ask Eva to. Each one is a Markdown file in the vault, in `.eva/settings/text-actions/` or `.eva/settings/saved-prompts/`. The file name is the name in the menu.
  - A text action can start with a `model:` line between two `---` lines: `haiku` (Fast), `sonnet` (Balanced) or `opus` (Smart). With no such line, it uses the fast model.
  - Eva brings Polish and Summary as examples, once. If you delete one, it stays deleted.
- **Files.** Open **Files** on the web page to browse the vault. Open a text file to read, edit and save it. You can also rename a file or a folder, download it, and copy the text of a file with **Copy contents**. The search finds a name, or a text inside the files. Eva shows text files up to 1 MB, and images, sounds and videos up to 50 MB. She hides the `.git` folder and a plain `.env` file. An encrypted file shows a lock: type the vault password to open it. Eva can also send a vault file in Telegram. In a chat with Eva, she saves each file, photo or audio file that you send her in `.eva/scratch/received/` in the vault. A general or specialist chat gets it in `.eva/scratch/received/<project-id>/`. Git never saves `.eva/scratch/`, and Eva deletes its files after a week. A vault from before this change also has a `Scratch/` folder, which its `.gitignore` lists. Eva writes nothing new there, and the folder goes away once its files are a week old. In a newer vault, `Scratch/` is a folder like any other.
  - **In a project chat in a clone,** a file that you send goes into the clone's `.mentions/` folder, outside every repository.
  - To give such a chat a vault file, such as a design or the notes of a meeting, type `@` in the web app and pick the file. Eva puts a copy in `.mentions/` too.
  - The chat gets the name of the copy, never the vault path.
  - Eva refuses a secret file, an encrypted file, a file that holds a secret, a folder, and a file in a clone of a project.
  - When a file that you mention is gone, Eva does not send the message, and says which file is gone.
- **Favorites.** Tap the star on a file or a folder in **Files** to make it a favorite. Your favorites show first on the Files page, so one tap opens them. Eva keeps them in `.eva/favorites.json` in the vault, so each computer shows the same ones.
- **Your location.** Share your live location with Eva's bot in Telegram, or open **Settings > Access > Your location** and allow a device to send its location while Eva is open. Eva keeps only the last location, as `lastLocation` in the header of `Life/About me.md`, so each computer sees it. The hub writes it at most once every 15 minutes, and only after a move of more than 50 m, or when the stored point is more than 6 hours old. So a day in one place makes only a few vault commits. Scripts such as a weather forecast use it. When your phone sent nothing in the last day, they use the home place of `Life/About me.md`.
- **Widgets.** A widget is a small web page on Eva's home page, in a grid below EVE's face. [docs/widgets.md](../widgets.md) tells how to make one. Open **Settings > Personalize > Widgets** to manage them.
  - The list shows each widget project of yours, each widget that ships with Eva, and each widget that you add by the address of its GitHub repository. Each one starts off.
  - Eva ships two widgets. [**Habits**](https://github.com/guplem/eva-widget-habits) tracks your habits in a vault folder: mark a habit for today on the card, and see its history, streaks and strength in full screen. [**Weather**](https://github.com/guplem/eva-widget-weather) shows the forecast for your last location. It sends that location to Open-Meteo, rounded to about one kilometre. With no location yet, it says how to share one.
  - **Turn on** asks for the widget's inputs, such as a vault folder, and shows what it may do: the places it reads or writes, your location and the web hosts it calls, each with its reason. Approve all of it, or press **Cancel** to leave it off.
  - A widget reaches only what you approved on this computer. A change of the widget, or of `.eva/widgets.json` by an agent, gives it nothing until you approve it again.
  - The list, the order and the inputs live in `.eva/widgets.json` in the vault. The approvals and a read-only copy of each widget stay on this computer. So another computer shows the same widgets, each with **Approve to show this widget**, until you approve it there.
  - **Turn off** hides a widget and keeps its approval. **Remove** drops its approval and its copy. Your data in the vault stays.
  - Each folder where a widget keeps data gets a `DATA_FORMAT.md`. Eva writes the whole file: it lists the files, the fields and the widget of each field. Do not edit it. Write your notes in the `AGENTS.md` or the `README.md` of the folder.
  - **Turn on** also shows the line that the widget adds to Eva's prompt. Each new chat with Eva gets it with your real folder. A project chat does not. So when you say "today I trained", Eva saves it where the training widget reads it.
  - Two widgets can share a folder. When one names a field with another type than the other, Eva warns you. Then turn the second widget on with read access only, or pick another folder.
  - After each answer, Eva checks the data files that it changed. A file that does not fit a widget goes back to the agent to fix. When the fix fails, the chat says which file and which field.
  - A widget is code from its author. Turn on only a widget whose author you trust.
  - Eva keeps each widget up to date. A new version that asks for nothing new installs by itself. A new version that asks for more waits: the old version keeps running, and Eva sends you a notice with what is new. In the list, press **Review the update** to approve it, or **Keep this version**.
  - Eva checks your own widgets every 30 minutes, and every other widget once a day. Change it in **Widget updates**, or press **Check for updates** to check now.
  - On a widget project, **Preview** on a clone shows the widget as the clone holds it, with no push. **Example data** shows its mock files. **My data** shows your vault, and asks first for anything that the installed widget does not have.
- **PDFs.** Install [typst](https://github.com/typst/typst/releases). Eva then writes a PDF in `.eva/scratch/` and sends it.
- **Voice notes.** Open **Settings > Updates**. In the **voice notes** row of **Versions**, press **Install**. Eva downloads ffmpeg, whisper.cpp and the `ggml-base.bin` model, which reads Spanish and English. Then press **Restart Eva**. The microphone in a chat also leads to this button. A voice note that you send in Telegram works too: Eva turns it into text on her computer. The audio never leaves the computer.
  On Linux, whisper.cpp also needs the OpenMP library. The one-command install adds it. If a voice note says that whisper-cli lacks `libgomp.so.1`, run `sudo apt install libgomp1` on Ubuntu.
  To install them by hand, install [ffmpeg](https://ffmpeg.org/download.html) and [whisper.cpp](https://github.com/ggml-org/whisper.cpp). Then download a model and put it at `voice/ggml-base.bin` in Eva's home folder.
- **Google (Calendar, Drive, Contacts, Tasks).** See [Set up Google](#set-up-google).

### Set up Google

Eva reaches your Google account through your own OAuth client: an id and a secret that let her ask Google for access. Steps 1 to 3 happen in Google Cloud, so you can do them before Eva runs. The Google part of **Settings** shows the same steps.

1. **Turn on the Google APIs.** [Make a project](https://console.cloud.google.com/projectcreate) with a name of 4 to 30 characters, for example `eva-assistant`. These APIs cost nothing, even when Google asks for a billing account. With that project selected, open each API and press **Enable**: [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com), [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com), [People API (Contacts)](https://console.cloud.google.com/apis/library/people.googleapis.com), [Google Tasks API](https://console.cloud.google.com/apis/library/tasks.googleapis.com).
2. **Set up the consent screen** (the page where Google asks you for permission). Open [Branding](https://console.cloud.google.com/auth/branding), press **Get started**, and pick **External**. Google needs two links before it publishes the app. In Branding, set **Application home page** to `https://github.com/guplem/eva`, **Application privacy policy link** to `https://github.com/guplem/eva/blob/main/PRIVACY.md`, and add `github.com` under **Authorised domains**. Press **Save**. Then open [Audience](https://console.cloud.google.com/auth/audience), and press **Publish app**, so that the status is **In production**. In **Testing**, your login ends after 7 days.
3. **Make an OAuth client.** [Make a client](https://console.cloud.google.com/auth/clients/create) of type **Desktop app**. Keep its client id and client secret in your password manager. A person that you trust, such as your partner, can use the same client.
4. **Log in to Google.** The Google tools run with [uv](https://docs.astral.sh/uv/), which `eva setup` installs. In **Settings**, paste the client id and secret, and press **Start the Google login**. On Google's page, press **Advanced** and go to the app, because Google did not verify it. Press **Allow**. Your browser then shows an error page, such as "This site can't be reached". This is correct. Copy the whole address from the address bar into Settings, and press **Finish**.
5. **Test it.** Press **Test Google**. It reads each service, or names the step to fix. Then press **Restart Eva**, so that chats use Google. To end the login, press **Log out** on the Google card. The OAuth client stays, so a new login needs no new setup.

`eva doctor` shows whether the login still works. Eva starts with read-only access. To let her change things, such as add events, press **Log in again** on the Google card. Then pick a step in **Google access**: "Keep my lists", "Change and draft" or "Everything". Pick "Custom" to set the level of each service. Then log in to Google again. She asks you before any change that reaches other people, such as an invitation. The Google tools work with Claude Code and with pi.

To add a service, such as Gmail, press **Log in again** on the Google card. In step 1, tick the service. Then turn on its API, such as the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com), in the same project. Your OAuth client stays the same. Pick its level in **Google access**, and log in to Google again. To let Eva send mail, pick "Read, sort, write drafts and send" or a higher level.
