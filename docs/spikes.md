# Spikes

A spike is a small real test of a claim the plan depends on. Each entry records the question, how it ran, and the result.

## S2: sessions, forks and the prompt cache (2026-10-14)

**Question.** Does the Claude Agent SDK accept a session id chosen by Eva, resume a session, fork it at any earlier message, and keep the prompt cache?

**How.** `@anthropic-ai/claude-agent-sdk` 0.3.300 under Bun 1.4.2 on Windows 11, with the user's installed `claude` 2.1.286 (`pathToClaudeCodeExecutable`), model `haiku`, a subscription token from `claude setup-token` in `CLAUDE_CODE_OAUTH_TOKEN`, an isolated `CLAUDE_CONFIG_DIR`, `settingSources: []`, and the `claude_code` preset with `append` and `excludeDynamicSections: true`. Five turns:

1. New session with `sessionId` set: "Remember ALPHA."
2. `resume`: "Remember BETA."
3. `resume`: "List the code words."
4. `resume` + `resumeSessionAt` (the uuid of turn 1's answer) + `forkSession: true`: "List the code words."
5. `resume` on the original session: "List the code words."

**Result.** Confirmed.

| Turn         | Answer      | Cache read tokens |
| ------------ | ----------- | ----------------- |
| 1            | OK          | 0                 |
| 2            | OK          | 25,326            |
| 3            | ALPHA, BETA | 25,444            |
| 4 (fork)     | ALPHA       | 25,326            |
| 5 (original) | ALPHA, BETA | 25,537            |

- The SDK used the session id that Eva chose.
- The fork got a new session id, saw only the history up to the fork point, and still read the cache.
- The original session was untouched by the fork.
- `apiKeySource` was `none`: the subscription token, not an API key, paid for the turns.
- The SDK ran under Bun on Windows with the native `claude.exe`.

## S3: what a Project session loads (2026-10-14)

**Question.** A Claude Code session started in `vault/Projects/<project>/repos/<repo>-0/` through the SDK, with `settingSources: ["user", "project", "local"]` and the `claude_code` preset: which instruction files and skills does it load? Does `.eva/skills/` stay out?

**How.** A sandbox vault with a marker word in `vault/AGENTS.md`, in the project `AGENTS.md`, and in the clone's `AGENTS.md`; an assistant skill in `vault/.eva/skills/`. Both folders are git repositories. The model quoted the marker words it could see, with file tools disabled. Run once without and once with a `CLAUDE.md` in the clone, and each time with and without an inline setting meant to load both file kinds.

**Result.**

| Clone has `CLAUDE.md` | Marker words loaded                                     |
| --------------------- | ------------------------------------------------------- |
| No                    | vault, project, repository (`AGENTS.md` at every level) |
| Yes                   | only the clone's `CLAUDE.md`                            |

- **Without a `CLAUDE.md`,** Claude Code walks up past the clone's own git root and loads every `AGENTS.md`. The project front matter reaches the session with no extra work.
- **With a `CLAUDE.md` anywhere in the chain,** no `AGENTS.md` loads. This matches opening the folder by hand, so Project mode (a transparent wrapper) keeps it. The vault must never hold a `CLAUDE.md`.
- **The inline setting** `pluginConfigs["cc-plugin-agents-md@builtin"]` had no effect. The correct key is unknown, and Project mode does not need it.
- **User skills from `~/.claude/skills/` loaded,** because the default config folder was used. That is what a manual session shows.
- **`.eva/skills/` never appeared** in a Project session.

## pi RPC: the protocol of `pi --mode rpc` (2026-10-15)

**How:** pi 0.73.1 ran in RPC mode against a fake OpenAI-compatible model server, with its own agent folder (`PI_CODING_AGENT_DIR`). Every stdout record was captured, with paths made neutral. The captures are `test/fixtures/pi/*.jsonl`; `src/engines/pi/` is built on them.

- **Framing:** one JSON record per line. Split on LF only: a record can hold U+2028, and one `message_update` line reached 600,939 characters (lesson 52).
- **Turn end:** pi 0.73.1 has no `agent_settled`. `agent_end` is final unless the last answer has `stopReason: "error"` and pi retries it; pi then sends `auto_retry_start` in the same tick. A `get_state` answer that arrives first means no retry follows.
- **Session handle:** `--session <path>` with a new path keeps that exact path, so Eva names the file before the first turn. The header id is pi's own. Always pass a path: a bare name starts a search across projects that asks y/N on stdin.
- **Fork:** RPC `fork` cuts only before a user message and names the file itself. Eva writes the branch file instead: the header, then the entries from the root to the chosen answer.
- **Entry ids:** RPC events carry none. Eva reads the session file after a turn for the id of the last answer.
- **Approvals:** pi has no permission prompts. An extension's `tool_call` handler calls `ctx.ui.confirm`, which reaches the client as an `extension_ui_request`; the client answers with `extension_ui_response`.
- **Usage:** each answer's `message_end` carries `input`, `output`, `cacheRead`, `cacheWrite` and `cost.total`.
- **Global writes:** `set_model`, `set_auto_retry` and similar commands write the person's global pi settings. Eva uses command-line flags only.
- **Windows:** after a tool ran, pi can exit with code 9 and an assertion on stderr, with the session file complete. Eva ignores the exit code after the turn end.
- **Context:** pi reads `AGENTS.md` (or `CLAUDE.md`) in every folder from the root down to the start folder, and skills from `~/.agents/skills` even with its own agent folder.

## Scripts

The spike script is not part of the engine. It lives with the owner's working files. Re-run a spike by following the "How" section with the SDK version named there.
