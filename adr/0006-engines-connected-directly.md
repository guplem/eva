# Engines connected directly: Claude Agent SDK and pi over RPC, ACP later

## Context

Eva runs existing harnesses instead of building her own, and depends on no single AI vendor. Claude Code is what the owner pays for. pi covers ChatGPT subscriptions, GitHub Copilot, and API keys, so it is the fallback if the Claude subscription ends. Forks and retries must keep working, with the prompt cache.

Source: spike S2; lessons 44, 52, 96, 101, 110 to 113.

## Decision

- **One engine port** in `src/shared/`. Each adapter under `src/engines/` implements it and emits the event union (`src/shared/events.ts`).
- **Claude Code through the Claude Agent SDK,** with the person's installed `claude` (config `engines.claudeCode.executable`, default `claude` on `PATH`). Eva sets `sessionId` before the first turn (lesson 44) and uses `resume`, `resumeSessionAt`, and `forkSession` for forks and retries. Spike S2 (a real run on 2026-10-14) confirmed all four, with the prompt cache kept. Eva always passes the `claude_code` system prompt preset (lesson 113).
- **pi as a child process,** `pi --mode rpc`, one process per turn (`src/engines/pi/`). Eva names the session file before the first turn and writes a fork's branch file herself, because RPC cannot cut at an answer. A small pi extension turns each tool call into an approval question. The stream reader has no line limit (lesson 52). The comments in `src/engines/pi/` record the protocol facts, from captured pi output (`test/fixtures/pi/`).
- **Every engine process gets an explicit allowlist of environment variables** (lesson 96). Eva's own secrets never reach an agent through the environment.
- **Each person uses their own login.** Eva never offers a claude.ai login, and never embeds `claude`.
- **More engines come later,** in this order: an engine-neutral background task system, ACP engines (OpenCode, Codex), a custom harness.

**Rejected alternatives:**

- **A generic ACP layer now.** It invites a generic layer before two real engines exist. ACP stays in "Later".
- **Embedding `claude` in Eva's executable.** It adds about 270 MB and breaks the update path.
- **pi inside the core process.** It would see every secret of the core.
- **Codex as an engine now.** Codex loads `AGENTS.md` only from the git root down, so a session in a clone does not see the vault or the project (lesson 107).
- **OpenCode before pi.** OpenCode cannot use a Claude subscription, and pi already covers ChatGPT and OpenRouter.
- **Adopt a full assistant product (OpenClaw, Hermes).** OpenClaw has a poor security record. Hermes is young and has its own memory model.

## Consequences

**Positive:**

- Forks, retries, and the prompt cache work as in a manual session.
- An engine switch needs a new adapter only; the core and the front ends stay the same (ADR 0005).

**Trade-offs and follow-up:**

- Adapter tests use output captured from a neutral demo vault, plus contract tests on the SDK options and the argument lists (lesson 101, ADR 0009).
- Spike S5, an owner check in `docs/owner-todo.md`, looks at what the SDK sends on a subscription token (lesson 110).
- A pskill harness entry for pi is needed before skill runs work with pi (`docs/owner-todo.md`).
- A Claude login inside pi bills as extra usage, so pi serves the other providers only.
