# Engines connected directly: Claude Agent SDK and pi over RPC, ACP later

## Context

Eva runs existing harnesses instead of building her own (intent goal 7). Claude Code is what the owner pays for. pi covers ChatGPT subscriptions, GitHub Copilot, and API keys, so it is the fallback if the Claude subscription ends (intent goal 6). Forks and retries must keep working, with the prompt cache (intent "Forks").

Source: plan §1 (D9), §4.5, §4.6, §7; spike S2; review R4, R18, R24; lessons 44, 52, 96, 101, 110 to 113.

## Decision

- **One engine port** in `src/shared/`. Each adapter under `src/engines/` implements it and emits the event union of plan §4.6.
- **Claude Code through the Claude Agent SDK,** with the person's installed `claude` (config `engines.claudeCode.executable`, default `claude` on `PATH`). Eva sets `sessionId` before the first turn (lesson 44) and uses `resume`, `resumeSessionAt`, and `forkSession` for forks and retries. Spike S2 confirmed all four, with the cache kept. Eva always passes the `claude_code` system prompt preset (lesson 113).
- **pi as a child process,** `pi --mode rpc`, with tree sessions and fork through RPC (phase P7). Eva raises the stream line limit for it (lesson 52).
- **Every engine process gets an explicit allowlist of environment variables** (lesson 96). Eva's own secrets never reach an agent through the environment.
- **Each person uses their own login.** Eva never offers a claude.ai login, and never embeds `claude`.
- **More engines come later,** in this order: an engine-neutral background task system, ACP engines (OpenCode, Codex), a custom harness (plan §7.3).

Parts that have no code yet are planned for phase P3 (Claude Code adapter) and P7 (pi adapter).

**Rejected alternatives:**

- **A generic ACP layer now.** It invites a generic layer before two real engines exist (R24). ACP stays in "Later".
- **Embedding `claude` in Eva's executable.** It adds about 270 MB and breaks the update path (R4).
- **pi inside the core process.** It would see every secret of the core (R18).
- **Codex as an engine now.** Codex loads `AGENTS.md` only from the git root down, so a session in a clone does not see the vault or the project (intent item 5, lesson 107).
- **OpenCode before pi.** OpenCode cannot use a Claude subscription, and pi already covers ChatGPT and OpenRouter (intent item 9).

## Consequences

**Positive:**

- Forks, retries, and the prompt cache work as in a manual session.
- An engine switch needs a new adapter only; the core and the front ends stay the same (ADR 0005).

**Trade-offs and follow-up:**

- Adapter tests use output captured from a neutral demo vault, plus contract tests on the SDK options and the argument lists (lesson 101, ADR 0009).
- Spike S5 must check what the SDK sends on a subscription token (lesson 110).
- A pskill harness entry for pi is needed before skill runs work with pi (plan §5.4).
