# Intent

This file records what the owner wants from Eva, what worries the owner, and how the idea changed during the design conversation of 2026-10-10 to 2026-10-14. `plan.md` must satisfy this file. A reviewer checks the plan against it.

## The problem

- **Everything is scattered.** Code lives on GitHub, heavy files on Google Drive, the project list in a Google Sheet, tasks in a task app and Google Tasks, short facts in Keep, notes in a git vault.
- **Projects are many and grow fast.** The owner can start several projects in one afternoon. Hundreds of project folders must stay easy to find.
- **Wall-I v1 mixed two things.** One repository held the personal notes and the Telegram server code. The notes autosaved to `main`, and the code needed branches and reviews.
- **Numeric project ids broke.** The `P##` ids needed fixes such as `P27A` and `P27B` when an old project was found later.

## Goals

1. **One point of interaction.** Eva is the single entry to the computer, the projects, AI, and personal life: calendar, tasks, reminders, contacts, Drive.
2. **Eva knows where everything is.** Ask "implement this change in project X", and Eva finds the project, clones the repository into the right folder, and does the work.
3. **Two modes, not fully isolated.**
   - **Assistant mode** helps with life and knowledge. It can read a project and give work to it.
   - **Project mode** works on one clone, exactly as if the owner opened that folder in the selected harness (for example Claude Code). It stays clean and isolated, and it does not work on the vault.
4. **Shareable.** The owner's partner runs her own instance, with her own vault and her own settings, and gets all features. Several instances can run on one machine.
5. **Easy to run.** Download, run (a terminal is fine), configure through a web page or the terminal. It runs on the owner's Linux server, and the owner works from any device.
6. **Not tied to one AI vendor.** Today the owner pays for Claude. If Anthropic restricts subscriptions further, or the owner cancels, a ChatGPT subscription, OpenRouter, or API keys take over.
7. **Control without rebuilding the world.** Full control, but no rebuild of what mature tools already do well. A custom harness can come later, in beta.
8. **Windows and Linux.**
9. **A public engine built well by AI agents.** The engine repository is public. CI and written standards keep the code consistent: strict patterns, architecture checks, high coverage, useful tests, red-green development.

## Concerns the owner raised

- **Vendor system prompts.** The Claude Code and Codex prompts focus on coding. They must not shape the assistant. In Project mode they stay.
- **Subscription rules.** Which harness can legally use which subscription.
- **Old problems.** Wall-I v1 solved many hard problems. The owner does not want to fight them again. `lessons-from-v1.md` lists them.
- **Forks.** Claude Code can fork a session today. Eva must not lose that. A retry is a new branch, and the old branch stays.
- **Hooks.** The owner first wanted both the vault's hooks and the project's hooks in a project session. The final answer: only projects keep their own hooks. Eva and the vault have no agent hooks, because each harness has a different hook system. Eva's own behaviour lives in her code.
- **Instances on one machine.** Instances can read each other's files. The owner accepts this. It is the user's responsibility, and forbidden paths can come later.
- **Remote access security.** The web page gives full shell access, so it must not be open to the internet.
- **Configuration effort.** Ideally one file, or a short guided setup.

## How the idea evolved

Read this list in order. A later item replaces an earlier one when they conflict.

1. **Restructure the vault.** Put `.claude/`, `.agents/` and `.pskill/` at the root. Add `Projects/` with one folder for each project, a metadata file, and cloned repositories that git ignores.
2. **Split the repository** into a public engine and a private vault.
3. **Build or adopt.** OpenClaw, Hermes, OpenCode, Codex and Claude Code were compared. The decision: a thin layer of our own over existing harnesses. OpenClaw has a poor security record. Hermes is young and has its own memory model.
4. **Two modes.** `ASSISTANT.md` is not a standard, and nothing loads it by itself. The base assistant prompt belongs to the engine. Personal assistant rules belong to the vault.
5. **Codex is dropped.** Codex loads `AGENTS.md` only from the git root down, so a session started in a clone does not see the vault or the project files.
6. **Eva owns vault sync,** in her code, not in hooks.
7. **Project ids become timestamps,** `YYYY-MM-DD-HHmm-name`, because several projects can start on one day. Unknown times get the closest estimate, researched from every source.
8. **An app.** The owner sketched three screens, saved in `mockups/`:
   - `project-mode.png`: projects with their clones, one conversation for each clone, forks drawn as branches with one input for each branch, retry and fork buttons, the branch name and pull request number.
   - `assistant-mode.png`: schedules (with "Add schedule") and chats, a conversation where a scheduled message shows a clock icon, a panel of background tasks, activity chips under messages.
   - `settings.png`: sections Setup, Appearance, Projects; GitHub token, vault repository, automatic fetch, Telegram bot token, harness choice, each with a Test button.
   - The app can act as the server and run the Telegram bot. It detects the projects from a marker. The owner first thought full computer access needs a native desktop app. The answer: the background service holds the access, so the UI can be web. A desktop window can come later.
9. **OpenCode was preferred, then left for later.** The owner wanted OpenCode over Claude Code. OpenCode cannot use a Claude subscription, and pi covers ChatGPT and OpenRouter, so Claude Code (main) and pi (fallback) came first.
10. **Remote access.** The owner asked about `slopus/opentunnel`. It has no access control. The owner chose Tailscale.
11. **Language does not matter; easy installation matters.**
12. **Process.** Rename the old repository to `vault`, create a new engine repository, write the plan there, review it with several agents, then restructure the vault. The owner first proposed an `old-server/` folder, and then accepted a git tag `server-final` instead. Move the knowledge to the vault root.
13. **The name becomes Eva.** "Wall-I" needed a hyphen in prose and `walli` in code, with exceptions everywhere. Eva is the clever robot of the film WALL-E; a robot body can come one day under its own name. Eva takes the pronoun "she".
14. **Project mode becomes a transparent wrapper.** Opening a clone in Eva must behave exactly as opening that folder in the selected harness.
15. **No temporary assistant during the build.** The owner prefers a complete result.
16. **The partner** has the same setup as the owner: a Windows laptop, an Android phone, a Claude subscription, and an instance on the owner's Linux server.
17. **pskill without hooks.** Eva keeps a programmatic skill run going herself, and only within the session that owns the run.

## Out of scope for now

- **WhatsApp.** No official bot API exists for a personal number, and unofficial libraries risk a ban.
- **Google Keep.** Its API works only for Google Workspace accounts.
- **One server process for many users.** Each person runs their own instance.
