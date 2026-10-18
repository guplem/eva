# Lessons from Wall-I v1

Wall-I v1 was a Python Telegram server plus a vault, in one repository. It ran from August to October 2026. This file lists every lesson it learned, so Eva does not learn them again.

**Source.** Each source is a path or a commit in the `guplem/vault` repository, at the git tag `server-final`. Read one with `git -C <vault> show server-final:<path>`.
**Status tags.**

- `[keep]`: the lesson applies to the new design as it is.
- `[adapt]`: the lesson applies, but the new design changes how. The arrow (→) says how.
- `[obsolete]`: the new design removes the cause.

The code must respect every `[keep]` and `[adapt]` item. A code comment cites one as "lesson N".

## 1. Where Claude Code reads instructions, settings, skills and subagents

1. `[adapt]` **v1 found that Claude Code loaded `CLAUDE.md` and never `AGENTS.md`,** so every `AGENTS.md` needed a one-line `@AGENTS.md` shim. → Current Claude Code reads `AGENTS.md`, but only when no `CLAUDE.md` exists in the folder or above it (lesson 112). The vault has no shims. Source: `adr/0001` rule 1.
2. `[keep]` **A nested `CLAUDE.md` loads only when the agent reads a file in its folder.** Files in the start folder and above load at launch. Source: `adr/0001`.
3. `[keep]` **Claude Code never reads `.claude/settings.json` from a folder above the start folder.** Hooks and deny rules exist only for the folder where a session starts. Notes filed from `walli/` never reached GitHub because of this. Source: `826687f`, `adr/0002`.
4. `[keep]` **A nested `CLAUDE.md` is not restored after a context compaction.** A rule that must never lapse goes in the root file or in the system prompt. Source: `adr/0001`.
5. `[keep]` **Skills are found by walking up from the start folder.** A skill at the vault root reaches every session started below it, project sessions included. Source: `adr/0001`.
6. `[keep]` **Subagents are found only by walking up.** They all live in the root `.claude/agents/`. Source: `adr/0001`.
7. `[keep]` **A nested skill refuses its own name until the agent reads a file in its folder.** Source: `adr/0001`.
8. `[keep]` **Never put an `@path` import in `AGENTS.md`.** It is a Claude Code feature. Other agents read it as plain text. Source: `e7c3ee5`.
9. `[keep]` **The persona and the vault map are separate files.** The persona is injected. The map loads for anyone who works in the folder. A maintainer who opened `walli/` once became the assistant. Source: `adr/0001`, `53cb348`.
10. `[adapt]` **The identity goes in the system prompt, never in a `CLAUDE.md`.** A system prompt survives compaction and reaches only an assistant session. → The engine's base assistant prompt plus the vault's `.eva/assistant.md`. Source: `server/adr/0004`.
11. `[keep]` **Read the identity file on every turn, and fail the turn when it is missing.** An answer from a nameless agent is worse than an error. Source: `53cb348`.
12. `[adapt]` **The start folder decides which rules load.** v1 turns started in `walli/`. → Assistant sessions start at the vault root. Project sessions start in the clone. Source: `942c517`.
13. `[keep]` **A path inside an instruction file is relative to that file's folder.** `walli/Knowledge/` written in `walli/AGENTS.md` resolved to `walli/walli/Knowledge`. The vault restructure rewrites every path. Source: `942c517`, `4a147e3`.
14. `[keep]` **Keep the root instruction file under about 200 lines.** Adherence drops above that. Source: `adr/0001`.

## 2. Git sync and autosave

15. `[adapt]` **Autosave is wrong for code.** v1 excluded code paths from the sweep. → The engine is in its own repository, and the vault holds no engine code. Source: `adr/0002`.
16. `[adapt]` **Machinery counts as code**, because a broken sync hook fails in silence. → Sync moves into the service, which logs and reports a failure. Source: `37f7d2a`.
17. `[keep]` **Wall-I must be able to edit its own rules and keep the edit.** The autosave keeps it. Source: `vault-sync-lib.sh`.
18. `[adapt]` **Sync does nothing on a conventional development branch.** → The vault has no development branches. The service syncs only the vault's default branch and never touches a clone under `Projects/*/repos/`. Source: `adr/0002`.
19. `[adapt]` **Hooks resolve the repository with `git rev-parse --show-toplevel`.** Inside a clone, that resolves to the clone, and a vault hook would push the project's `main`. → The service syncs an explicit vault path, never the current folder. Source: `826687f`.
20. `[adapt]` **Use one OS lock in the git common directory, never a `mkdir` lock.** Three `mkdir` versions raced. → One process owns the sync, with an in-process lock. Keep an OS lock for the transition, while v1 hooks still run. Source: `2eb81bf`, `91972ef`, `c85984f`.
21. `[adapt]` **Windows has no `flock`, so v1 hooks ran unlocked there.** → Eva's sync runs in one process with an in-process lock. The temporary v1 hooks are removed on a machine as soon as Eva syncs there, so the two never run together. Source: `.claude/hooks/vault-sync-lib.sh`.
22. `[keep]` **Refuse to save while a rebase is open.** An abort otherwise throws the new notes away. Source: `b7332f7`.
23. `[keep]` **Push only when `HEAD` has commits that `origin/main` lacks. Retry fetch, rebase and push up to 3 times.** A merge caused a false "push rejected" message. Source: `60b41a1`.
24. `[adapt]` **Stay inside the hook timeout**, because a killed hook says nothing and can leave a rebase open. → The service bounds every git step with its own timeout and cleans up. Source: `b7332f7`.
25. `[keep]` **Rebase with `--autostash`.** Source: `adr/0002`.
26. `[adapt]` **v1 `sync-pull.sh` always exited 0 and reported failure only in a JSON line.** → The service reports sync state in the UI and in `/status`. Source: `server/AGENTS.md`.
27. `[keep]` **A pre-commit hook must never block an autosave commit.** Source: `.githooks/pre-commit`, `4ef7d76`.
28. `[adapt]` **A repository that autosaves to `main` cannot have a required-check ruleset.** Source: `adr/0002`. → The engine repository has one: the "Requirements for merge" ruleset requires every CI check.
29. `[keep]` **Gitignore anything secret, per-machine, or a cache.** Autosave pushes it within seconds otherwise. Source: `.gitignore`.
30. `[keep]` **The lock orders git operations, not agents.** Two conversations can edit one note, and one edit can be lost. Accepted. Source: `ARCHITECTURE.md` section 7.

## 3. Hooks and permissions

31. `[keep]` **A hook fails in silence.** Behaviour tests for hooks are mandatory. Source: `.claude/AGENTS.md`.
32. `[keep]` **A deny rule that blocks writing must say `Edit(...)`.** `Write(...)` matches nothing, and Claude Code allows the write. Source: `f62ab05`.
33. `[keep]` **Deny paths must be absolute (`//**/.env`).** A relative path does not leave the start folder. Source: `f62ab05`.
34. `[keep]` **Deny rules still hold under `bypassPermissions`.** They are the only permission layer for unattended Claude Code turns. Other engines have no such layer. Source: `.claude/AGENTS.md`.
35. `[keep]` **Every `ask` rule costs a prompt.** Keep `ask` rules rare. Source: PR #34.
36. `[keep]` **Never detect engine output by its English wording when a structured field exists.** v1 detected a Stop hook notice by the text `Stop says: `. Source: `server/AGENTS.md`.
37. `[keep]` **A hook exits quietly when an expected variable is unset.** Source: `4ef7d76`.

## 4. Prompt cache and cost

38. `[keep]` **A cached follow-up costs about 1/20 of a first turn.** Anything that changes the prompt prefix costs money. Source: `server/adr/0006`.
39. `[keep]` **Pass `--exclude-dynamic-system-prompt-sections` to Claude Code**, or `git status` in the prompt breaks the cache after every autosave. Source: `server/adr/0006`. → In the Agent SDK, the same option is `excludeDynamicSections: true` on the `claude_code` preset. A fully custom prompt uses the `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` line instead (Claude Code docs, not v1).
40. `[keep]` **The system prompt must be byte-identical across turns.** The local time goes in the user message. Source: `d991e63`.
41. `[keep]` **A model belongs to a conversation.** A switch throws the cache away, so the UI warns, and the model choice comes first in a new chat. Source: `server/adr/0006`.
42. `[keep]` **A schedule with a prompt pays a full uncached turn every time.** Fixed content uses a `text` or `file` step. Source: `server/adr/0013`.
43. `[keep]` **Commands never reach the agent**, so they cost nothing. Source: `server/AGENTS.md`.

## 5. Sessions, history and concurrency

44. `[keep]` **The service generates the session id before the turn starts.** A turn that dies early stays resumable. Source: `server/adr/0004`.
45. `[adapt]` **One CLI process for each turn, and the engine owns the history.** A crash costs one answer. → Keep "the engine owns the history". A long-lived process is allowed only if a crash still loses at most one turn. Source: `server/adr/0004`.
46. `[keep]` **Detect a lost history, retry once with a short preamble, and clear the stored id at once.** v1 matched the text `No conversation found with session ID`. Source: `d490dbd`, `ceeef90`.
47. `[keep]` **Every turn stream ends with exactly one end event.** Without it the UI shows "working" for ever. Source: `ceeef90`.
48. `[keep]` **Capture the conversation key when the turn starts.** A new chat during the turn otherwise moves the session id to the wrong thread. Source: `39988e8`.
49. `[keep]` **No `await` between the busy check and taking the lock.** Any path that resets a conversation refuses while a turn runs in it. Source: `ff49812`.
50. `[keep]` **A task nobody awaits hides its crash.** Log it, and keep the setup inside the `try`. Source: `server/AGENTS.md` traps, `e7c7954`.
51. `[keep]` **Gather messages for 1 second**, so a forward of several messages shares one turn. Source: `ARCHITECTURE.md` section 3.
52. `[adapt]` **Raise the stream line limit.** One `Grep` result passed 64 KB and aborted a turn. → Applies to any engine read as a child process, such as pi in RPC mode. The Agent SDK handles its own stream. Source: `server/adr/0004`.
53. `[adapt]` **Claude Code `stream-json` output needs `--verbose`**, and the error does not say so. → Only if Eva ever calls `claude -p` directly. The Agent SDK sets its own flags. Source: `server/adr/0004`.
54. `[adapt]` **State files: write a temporary file and rename it. Drop an old format instead of migrating it. Never crash on a bad file.** Source: `ARCHITECTURE.md` section 7. → Eva changes a stored format with a dated migration in `src/core/migrations/`.
55. `[keep]` **Deleting a chat does not delete the engine's transcript.** Say so in the UI. Source: `ARCHITECTURE.md` section 4.

## 6. Telegram

56. `[keep]` **Only one poller for each bot token.** Count 409 errors, and do not let a success reset the count. Two servers flapped for ever. Source: `de9ab58`. → Eva counts the 409 errors of the last 2 minutes. At 3, she logs an error and pauses only the bot for 10 minutes; the core runs on, because the owner may reach Eva only through Telegram.
57. `[keep]` **Confirm the update offset before any deliberate exit.** Retry 3 times, or the whole batch replays. Source: `b8b686a`.
58. `[keep]` **Format answers as Telegram HTML, never MarkdownV2.** Split at 4000 characters before the conversion, and fall back to plain text. Source: `server/adr/0002`, PR #58.
59. `[keep]` **Service messages stay plain text.** Commit subjects and paths are not Markdown. Source: `server/AGENTS.md`.
60. `[keep]` **`message_thread_id` alone does not prove a topic.** Check `is_topic_message`. Source: `server/adr/0005`.
61. `[keep]` **Topics in private chats need a BotFather setting that Telegram caches for hours.** A refused topic must never break a turn. Source: `server/AGENTS.md`.
62. `[keep]` **Size limits:** callback data 64 bytes, downloads 20 MB, uploads 50 MB, a keyboard 100 buttons. Source: `server/adr/0010`.
63. `[keep]` **Answer a stranger's chat with its chat id.** Silence made a working lock look like a lost message. Source: `server/adr/0005`.

## 7. Schedules

64. `[adapt]` **Schedule definitions live in the vault. Learned state, such as a topic id, lives on the machine.** → Definitions in `.eva/schedules.json`. State in the instance home. Source: `server/adr/0013`.
65. `[keep]` **Never reuse or change a schedule id.** State is keyed by it. Source: `schedule` skill.
66. `[keep]` **A new or changed schedule shows a setup card before it first fires.** It is the check against an injected schedule. Source: `7a9d581`, `d9f2c8b`.
67. `[keep]` **Anyone who can push to the vault can make the machine run a prompt.** Accepted, with the setup card as the check. Source: `server/adr/0005`.
68. `[keep]` **Catch up a missed firing within 1 hour. Fire once when the clocks go back. Use a configured time zone, because a server clock is often UTC.** Source: `613418f`, `d991e63`.
69. `[keep]` **Read the schedules file tolerantly.** Deep JSON raised `RecursionError`. Skip a bad entry, not the whole file. Source: `613418f`.
70. `[keep]` **A topic deleted in the Telegram app shows as a 400 error on a typing action.** Source: `7367e0a`.

## 8. Voice and files

71. `[adapt]` **Transcribe voice on the machine**, so audio never leaves it. v1 used faster-whisper in Python. → Pick a transcriber that fits a single executable, for example a `whisper.cpp` binary that the service downloads once. Source: `server/adr/0011`.
72. `[keep]` **A file the agent can send: resolve the path first, then check that it sits inside an allowed folder.** One wrong path could upload a secret. Source: `server/adr/0010`.
73. `[keep]` **A path written from one allowed folder can lead into another allowed folder.** Accept it. Source: `e256fff`.
74. `[keep]` **Name scratch files by content**, because two conversations write at once. Source: `4a147e3`.
75. `[adapt]` **v1 made PDFs with the `typst` Python wheel**, because Ubuntu Server lacks fonts. → Bundle or download a `typst` binary. Source: `server/adr/0010`.

## 9. Windows and Linux

76. `[keep]` **On Windows, a bare `bash` starts WSL.** Resolve Git Bash, and skip the `System32` and `WindowsApps` aliases. Source: `8354059`, `8f16f75`.
77. `[keep]` **PowerShell 5.1 does not escape inner quotes in a native argument.** Prefer passing long text through a file or stdin. Source: `3c22bd6`.
78. `[keep]` **PowerShell 5.1 reads a file with no BOM as ANSI.** Always read and write with explicit UTF-8. Source: `walli-install-lib.ps1`.
79. `[keep]` **PowerShell 5 has no `&&`, and Windows `scp` drops the execute bit.** Source: `207d286`.
80. `[keep]` **Pin `*.sh` to LF in `.gitattributes`.** A CRLF shebang breaks Linux. Commit scripts as 100755. Source: `.gitattributes`, `b5e6eb1`.
81. `[keep]` **Stop a child process tree gently, then hard.** Send SIGTERM to the group before SIGKILL, because git leaves `index.lock` after SIGKILL. Use `taskkill /T` on Windows. Bound every wait. Source: `78e0048`, `c72354c`.
82. `[keep]` **Windows blocks reads of a locked byte range.** Keep a pid outside the lock file. Source: `5740aae`.
83. `[keep]` **`time.time()` resolution on Windows is about 16 ms.** Never order events by a timestamp alone. Source: `server/adr/0007`.
84. `[keep]` **Use `C:\Windows\System32\OpenSSH\ssh.exe` with `BatchMode` from Windows.** Git Bash's ssh could not reach the server. Source: `server/AGENTS.md`.
85. `[keep]` **systemd user service:** enable linger, set `XDG_RUNTIME_DIR` and an explicit `PATH`, and map exit codes to restart rules. Source: `server/adr/0008`, `install-service.sh`.
86. `[keep]` **Wi-fi power saving stalled GitHub for up to 45 seconds on the server laptop.** Prefer a cable, or turn power saving off. Source: the server machine guide in `server/machines/`, `50cf793`.
87. `[keep]` **Setup scripts:** wait for the apt lock, pass tokens through the environment and never through argv, validate each input, and write a file only when the value changed. Source: `207d286`.
88. `[keep]` **A launcher waits for Enter after an error only when stdin is a terminal.** Source: `5f8ff74`.

## 10. Supervision and self-update

89. `[keep]` **Exit codes are a contract with the supervisor:** clean stop, crash, bad settings, second instance (never retried), restart for an update. Source: `server/AGENTS.md`.
90. `[adapt]` **"New code" means the code differs, not that new commits exist.** → For a single executable, "new code" means a new version number. Source: `b3563be`.
91. `[keep]` **Check a new version in a separate process before switching to it.** A failed check keeps the old version running. Source: `server/adr/0009`, `8df7b15`.
92. `[keep]` **An update refuses to start while a turn or a schedule runs.** Source: `server/adr/0009`.
93. `[keep]` **Decide an engine update's result from the exit code and the version before and after, never from its text.** Source: `a94bfcb`.
94. `[keep]` **Every core dependency has a status line, an install path and an update path.** A version read never raises. Source: `server/AGENTS.md`.

## 11. Secrets and GitHub access

95. `[keep]` **Redact secrets from every log record, tracebacks included.** Telegram URLs contain the bot token. Source: `e7c7954`, `5740aae`.
96. `[adapt]` **v1 passed its whole environment to the agent, bot token included.** → Give each engine process an explicit allowlist of variables. Source: `config.py`, `claude_code.py`.
97. `[keep]` **An unattended machine needs `claude setup-token`.** A desktop login's token expires. Source: `server/AGENTS.md`.
98. `[keep]` **A deploy key for each machine and repository never expires.** Tick "Allow write access". Check push access with a dry run to a branch that does not exist. Source: `bootstrap.sh`.
99. `[keep]` **A fine-grained token that acts as the owner means the owner cannot approve that token's pull requests.** Source: `server/adr/0012`.
100.  `[keep]` **Set `GIT_TERMINAL_PROMPT=0`, with no stdin, on every git step.** Source: `server/walli_server/git_code_updater.py`.

## 12. Testing

101. `[keep]` **Engine parser tests use captured real output. Contract tests check the argument lists.** Only a real run catches a dropped flag. Source: `server/adr/0007`.
102. `[keep]` **Fake only at a few named seams** (chat platform, git, engine, clock). A second path to one of them escapes the tests. Source: `server/adr/0007`.
103. `[keep]` **A coverage floor of 90, not 100.** None of the shipped bugs would have been caught by more coverage. Source: `server/adr/0007`.
104. `[keep]` **Hook and git tests must clear the `GIT_*` variables that git exports.** Otherwise they write the real index. Source: `test-sync-push.sh`.
105. `[keep]` **Run shellcheck with `-x --source-path`.** Source: `check-machinery.sh`.
106. `[keep]` **No automated writing checker.** It flagged false faults and damaged prose. Source: `6881afe`, `adr/0003`.

## New facts learned during the Eva design

107. **Codex loads `AGENTS.md` only from the nearest git root down to the start folder.** A session started in a nested clone does not see the parent folders. `project_root_markers` changes the root, but only from user config or `-c`.
108. **pi and OpenCode walk up through parent folders.** Claude Code walks up to the filesystem root and ignores git boundaries.
109. **Agent hooks run only from the start folder. Git hooks run in whatever repository receives the commit.** Project sessions start in the clone, so the project's own agent hooks run.
110. **The `claude` program adds its own identity line before a custom system prompt,** and a billing line before that. The SDK docs say it sends only what you provide. Source: spike S5 (#56) logged a real request.
111. **Each Eva instance gives its engines their own config folders** (`CLAUDE_CONFIG_DIR`, pi's agent folder, `GH_CONFIG_DIR`). Two instances on one OS user otherwise share one login, and a person would use another person's subscription.
112. **A `CLAUDE.md` in the start folder or any folder above it stops Claude Code from reading `AGENTS.md`.** The SDK setting `claude-md-and-agents-md` loads both. Source: https://code.claude.com/docs/en/memory
113. **The Agent SDK without `systemPrompt` uses a minimal prompt,** not the Claude Code prompt that `claude -p` uses. Pass the `claude_code` preset. Source: https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts
114. **A message sent while a turn runs must wait, and join the next prompt.** Two turns on one session id split the conversation. Source (v1): `705d2de`, `ARCHITECTURE.md` section 3, step 5.
115. **Claude Code records the system prompt on the first request of a session** and reuses it until compaction. An edit to the assistant rules reaches a running session only after its next compaction. Source: https://code.claude.com/docs/en/cli-reference
116. **Deny rules are weak protection.** A `Read` deny does not stop `Bash(cat ...)` under `bypassPermissions`. The vault's `.claude/settings.json` never reaches a session started in a clone (lesson 3). The real protection is the env allowlist, redaction, and secrets kept outside the agent's reach. Source (v1): `4ef7d76`, `server/adr/0005`.
117. **An MCP server started through `uvx` or `npx` fetches its newest version at each start,** and runs with the person's tokens. Pin exact versions.
118. **Only one instance fires the schedules.** Every machine runs an instance, so every machine would otherwise fire every schedule. Source (v1): lessons 56 and 64.
119. **Least privilege for GitHub.** v1 gave the vault's contents only to a deploy key, and gave the agent a fine-grained token with no `Contents` permission. Source (v1): `server/adr/0012`.

## Lessons added by the review

120. `[keep]` **Report cache token counts** in `/status` and in the log, so a broken cache shows. Source: `server/adr/0006`.
121. `[keep]` **Store a model by its alias, from a closed set.** A full model id goes stale. Source: `08a5fa2`.
122. `[keep]` **A laptop server must ignore the lid switch,** or it sleeps when the lid closes. Source: `server/adr/0008`, `207d286`.
123. `[keep]` **Voice: echo "Heard: ..." before the answer, skip silence with VAD, keep the audio in memory only, and transcribe one note at a time.** Source: `server/adr/0011`.
124. `[keep]` **A file marker in an answer is plain text, not an event. Offer ids are stored on disk,** so a button still works after a restart. Source: `server/adr/0010`.
125. `[keep]` **Rename only the Telegram topics that Eva created.** A topic the person named keeps its name. Source: `ARCHITECTURE.md` section 4.
126. `[keep]` **Each schedule firing starts a fresh conversation.** Source: `server/adr/0013`.
127. `[keep]` **Fail closed until the allowed chat id is set.** Answer with the chat id and do nothing else. Source: `server/adr/0005`.
128. `[keep]` **When the assistant changes its own rules, it commits the edit with its reason** before the autosave sweeps it into an anonymous commit. Source: `update-walli` skill.
