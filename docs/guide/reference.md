# Eva reference

Every command and setting, for when the [README](../../README.md) is not enough. In Telegram, type `/` to see every command. On a computer where Eva runs from source, type `bun run eva` where this page says `eva`.

## Commands

Run these on the computer where Eva runs. Seven commands need Eva to run: `status`, `link`, `open`, `devices allow`, `chat`, `projects` and `work`. The other commands also work when Eva is stopped.

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
| `eva chat --project <id>`         | Talks to a project's coding agent. `--clone <name>` picks the copy of the code, such as `clone-0`, when it has no open chat.                                                        |
| `eva chat --model <model>`        | Picks the model: `smart`, `balanced` or `fast`. Without it, the model from the settings.                                                                                            |
| `eva chat --engine <engine>`      | Picks the engine: `claude-code` or `pi`.                                                                                                                                            |
| `eva projects [words]`            | Searches your projects. `status:active` and `tag:work` filter them.                                                                                                                 |
| `eva work <project> <request>`    | Gives work to a project; a coding agent does it in a free copy of the code.                                                                                                         |
| `eva sync`                        | Gets other computers' notes, then saves and pushes this computer's notes.                                                                                                           |
| `eva update [version] [--check]`  | Installs what the policy allows, or the version given. `--check` only looks.                                                                                                        |
| `eva hub`                         | Makes this computer the hub, which runs Telegram and the reminders.                                                                                                                 |
| `eva settings`                    | Lists every setting; `(vault)` marks the settings that every computer shares.                                                                                                       |
| `eva settings get <key>`          | Shows one setting, such as `updates.frequency`.                                                                                                                                     |
| `eva settings set <key> <value>`  | Changes one setting, such as `eva settings set updates.frequency weekly`.                                                                                                           |
| `eva version`                     | Shows Eva's version.                                                                                                                                                                |
| `eva help`                        | Shows every command.                                                                                                                                                                |
| `eva --instance <name> <command>` | Runs the command for the Eva with this name, as `EVA_INSTANCE=<name>` does. Without it, `eva` asks which Eva, or uses the only one.                                                 |

## Settings

Eva keeps her settings in two places, and her tokens in a third:

- **Your settings live in your vault,** in `.eva/settings/settings.json`, so every computer with the vault uses the same ones.
- **This computer's settings live in Eva's home folder** (`~/.config/eva-<name>` on Linux, `%APPDATA%\eva-<name>` on Windows, where `<name>` is the name of this Eva), in `config.json`.
  - **The settings that decide who may open Eva, and what an agent may do, are always computer settings.** The table marks them "(security)". Eva's AI agent edits the vault as part of its work, so these never live there.
- **Tokens live in `secrets.json`** in Eva's home folder, never in the vault: `githubToken`, `telegramBotToken`, `claudeOauthToken`, `localApiToken`, `googleOauthClientId` and `googleOauthClientSecret`.

In the vault:

| Setting                     | Default        | What it does                                                                               |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `timeZone`                  | Asked at setup | The time zone of the reminders, and of the time in each message.                           |
| `sync.pullIntervalMinutes`  | `5`            | Minutes between two fetches of other computers' notes. `null`: only before each chat turn. |
| `sync.sweepSeconds`         | `60`           | Seconds between two saves of changed notes.                                                |
| `updates.frequency`         | `daily`        | How often Eva looks for a new version: see [Updates](#updates).                            |
| `updates.install`           | `minor`        | What Eva installs by herself: see [Updates](#updates).                                     |
| `engines.default`           | `claude-code`  | The engine of a new chat: `claude-code` or `pi`.                                           |
| `engines.defaultModel`      | `opus`         | The model of a new chat: `opus` (Smart), `sonnet` (Balanced) or `haiku` (Fast).            |
| `engines.defaultEffort`     | `medium`       | The effort of a new chat: `low`, `medium`, `high`, `xhigh` or `max`.                       |
| `engines.pi.models.<model>` | `null`         | The pi model of each of the 3 tiers, such as `openai/gpt-5`. `null`: pi's own default.     |
| `google.email`              | `null`         | The Google account. The Google login sets it.                                              |
| `voice.language`            | `null`         | The language of voice notes, such as `es`. `null`: whisper finds it.                       |

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

Change a setting on the web Settings page, or with `eva settings set`. The update frequency, the update policy, the vault fetch and the trusted repository owners apply at once. Any other change applies at the next restart.

- **Tokens:** log in to GitHub and Claude Code on the Settings page, or paste their tokens there. Paste the Telegram token there too. The page never shows a saved token again. Press **Test** to check it. Then press **Restart Eva**, so that chats and the vault sync use it too. A card with a done login shows a green panel. Its **Log out** button removes the login, after a warning. Its **Log in again** button shows the steps again. A paired Telegram bot shows **Disconnect** and **Set up again** instead.
- **Test buttons:** each one makes a small, real check. The engine Test sends one tiny prompt, so it uses a little of your subscription.
- **A device that you allowed** has the same control as the terminal of Eva's computer: it can change every setting and token. If you lose a phone, tap "Log out every device" on the Settings page.
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
- **Files that Eva does not save:** a file that looks like a secret (outside `Projects/`), and any file over 50 MB, because GitHub refuses files over 100 MB. `eva status` and the Settings page name them.

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

## Problems and alerts

Eva sends each alert to your Telegram chat when the problem starts, again once a day while it lasts, and once more when it ends. The open problems also show on the web page, because Telegram itself can be the problem. Tap Eva's face in the menu to open the notification center. It lists each open problem with the button that fixes it, and what Eva told you in the last 30 days.

Press **Mark as read** on a problem to quiet it. It stays in the list, but Eva's face stops counting it, on every device that opens this Eva, until the problem becomes an error or ends. Eva sends no daily reminder for it, also when you mark it as read on another computer. `/status` still counts it.

From a phone: `/status` shows the problems and the version of Eva and each tool, `/logs [n]` shows the last `n` warnings and errors (20 by default), and `/restart` restarts Eva after you confirm. The Settings page has a **Restart Eva** button too. Its **Updates** section shows the version of Eva and each tool.

| Alert                                | When                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| The vault sync stopped on a conflict | Two computers changed the same note: see [Vault conflicts](#vault-conflicts).                        |
| The vault sync failed                | A git step failed two times in a row, for example on a full disk or a refused push.                  |
| The vault cannot reach GitHub        | The vault was offline for more than 30 minutes.                                                      |
| The update check or install failed   | The checks failed for 2 hours or more, or an install failed. A failed install keeps the old version. |
| The Claude Code update failed        | The alert names the reason. Chats keep the old version of Claude Code.                               |
| A reminder failed to run             | The alert names the reminder.                                                                        |
| A reminder waits for its card        | No card reached you, so it does not run: see [Optional features](#optional-features).                |
| Eva started after an unclean exit    | A crash or a power cut stopped her. Send `/logs`.                                                    |
| Eva cannot read Telegram             | Another program uses the bot, or Telegram failed for over 15 minutes.                                |

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
- **Open one chat on the web page:** add `#/chat/<id>` to the address. Telegram sends such links.
- **Retry an answer:** press **Retry** under it on the web page. The new answer goes in a new branch, and the old answer stays. When the answer, or a later one, changed vault files, Eva asks first:
  - **Undo and retry** puts those files back as they were before the answer, and saves that as a new commit.
  - **Keep and retry** does not change them.

  Eva restores only files: a sent message or a calendar event stays. A file that changed after the answer stays too, and so does a file that Eva does not save in git, such as a file in `Scratch/`. The question names them. With the vault sync off, Eva does not ask.

## Projects

- **Create a project:** open **Projects** in the web app and tap **New project**. Give a name, a short description, a status and tags. Eva makes the folder `Projects/<date>-<time>-<name>/` in the vault, with its `AGENTS.md`.
  - Tick **Create a GitHub repository** to get a repository in your GitHub account. It takes the folder name without the date and time.
  - Pick its type. **Standard** gets a first commit and the security items that GitHub offers. **Vibe-coded** follows the [vibe-coded standard](../vibe-coded-standard.md): Eva sets up what she can, then opens a project chat for the rest. That chat merges its own pull request.
  - Pick **Private** or **Public**. A private vibe-coded repository uses the CI minutes of your GitHub account, and some guards of the standard need a paid plan.
  - Tick **Create a Google Drive folder** to get a folder in your Drive. It needs the Drive access "Read and change", in **Settings > Connections > Google**.
  - When one of these steps fails, the project stays. The form says what failed, so you can do that step by hand.
- **Repository setup:** open it from the project page. It checks each repository by its type. A repository with no type, such as one that you added by hand, shows no report: pick its type first.
  - **Fix** on an item that a command can fix runs it on GitHub at once. Press **Refresh** to see the item turn green. Any other **Fix** opens a chat with the request.
  - **Fix all** runs every fix that a command can do. Then it opens one chat for the rest, when something is left.
- **Clones and chats:** a clone is a copy of every repository of a project, in `Projects/<project>/repos/clone-<n>/`. Each repository has its own folder inside it. A project chat starts in the clone folder, so the agent sees every repository. It loads the project's `AGENTS.md`, but no instruction file above the project folder, such as the vault's `AGENTS.md`. So the chat does not know that it runs inside your vault. Claude Code reads hooks, `.claude/settings.json` and `.mcp.json` only in its start folder. So it loads none of them from a repository. Git hooks still run.
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
- **What Eva may do:** **Settings > AI engines > What Eva may do** lists, for each engine and each kind of chat, what runs with no question, what Eva asks you first and what never runs. It also lists your own Claude Code `allow`, `ask` and `deny` rules apart, with the file that holds them: the `settings.json` in this Eva's Claude Code folder, and `.claude/settings.json` in your vault.

## Optional features

Each feature stays off until you set it up. `eva doctor` shows which tools are missing.

- **Reminders and repeated tasks.** Ask Eva for a reminder or a daily summary, or open **Schedules** in the web app. A schedule runs at a time on some days of the week, or every few hours, days or weeks from a first run. Eva keeps them in `.eva/schedules.json` in the vault, and only the hub runs them. When a chat adds or changes a schedule, Eva asks you first.
  - Before a new or changed schedule runs, Eva shows a card with every detail, in Telegram or in the web app. Check it, and tap **Got it**. If you did not make it, tap **Remove schedule**.
  - A schedule waits until a card reaches you, and Eva sends an alert meanwhile.
  - The Schedules page shows what runs today, when each schedule repeats, and how its last run went. Tap the pen on a schedule to change it: its history stays.
- **Eva's rules.** Your rules for Eva set her personality, how she answers and how she stores what she learns. Read and change them in **Settings > Personalize > Eva's rules**, or ask Eva to change them. They live in `.eva/assistant.md` in the vault.
  - They apply to each chat with Eva, in Telegram, on the web page and from a schedule, from the next new chat. A project chat never uses them. It uses the harness's own prompt and the instruction files of the project and its repositories, such as `AGENTS.md`. It never loads the vault's instruction files.
  - Eva's built-in rules come first and say how Eva works, such as how she gives work to a project. The page shows them, but only an update of Eva changes them. Where the two disagree, your rules win.
  - **Restore the default** replaces your rules with Eva's default rules. It first offers to save your old rules in a backup file in `.eva/`.
- **Chat names.** A chat takes the first line of its first message as its name. To name chats your way, write rules in **Settings > Personalize > Chat names**, or ask Eva to, such as "Lead every name with an emoji". After the first answer, a small AI call with your engine login names the chat by your rules. Your own rename always wins.
- **Text actions and saved prompts.** Tap the command button (a slash in a square) in the message box of a web chat to open its menu.
  - A text action, such as **Polish**, asks a model to rewrite the text in the box. It sends nothing. The model sees only that text. **Undo** brings back your text.
  - A saved prompt, such as **Summary**, puts its text at the cursor.
  - Change them in **Settings > Personalize > Message box menu**, or ask Eva to. Each one is a Markdown file in the vault, in `.eva/settings/text-actions/` or `.eva/settings/saved-prompts/`. The file name is the name in the menu.
  - A text action can start with a `model:` line between two `---` lines: `haiku` (Fast), `sonnet` (Balanced) or `opus` (Smart). With no such line, it uses the fast model.
  - Eva brings Polish and Summary as examples, once. If you delete one, it stays deleted.
- **Files.** Open **Files** on the web page to browse the vault and read its text files. Eva shows text files up to 1 MB. She hides the `.git` folder and does not show a secrets file, such as `.env`. Eva can also send a vault file in Telegram. She saves each file, photo or audio file that you send her in `Scratch/received/` in the vault. Git never saves `Scratch/`, and Eva deletes its files after a week.
  - **In a project chat in a clone,** a file that you send goes into the clone's `.mentions/` folder, outside every repository. Type `@` to give the chat a vault file, such as a design or the notes of a meeting: Eva puts a copy there too. The chat gets the copy's name, never the vault path. Eva refuses a secrets file, a folder, and a file of a clone. When a mentioned file is gone, Eva does not send the message, and says which file is gone.
- **Favorites.** Tap the star on a file or a folder in **Files** to make it a favorite. Your favorites show first on the Files page, so one tap opens them. Eva keeps them in `.eva/favorites.json` in the vault, so each computer shows the same ones.
- **Your location.** Share your live location with Eva's bot in Telegram, or open **Settings > Access > Your location** and allow a device to send its location while Eva is open. Eva keeps only the last location, on the hub computer, never in the vault. Scripts such as a weather forecast use it. When your phone sent nothing in the last day, they use the home place of `Life/About me.md`.
- **PDFs.** Install [typst](https://github.com/typst/typst/releases). Eva then writes a PDF in `Scratch/` and sends it.
- **Voice notes.** Open **Settings > Updates**. In the **voice notes** row of **Versions**, press **Install**. Eva downloads ffmpeg, whisper.cpp and the `ggml-base.bin` model, which reads Spanish and English. Then press **Restart Eva**. The microphone in a chat also leads to this button. The audio never leaves the computer.
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
