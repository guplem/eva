# Agent files in open formats: AGENTS.md, Agent Skills, and thin tool adapters

## Context

AI agents build most of the engine (plan §13), so the repository must carry its own rules. Eva is a public, personal project: anyone may fork it and work on it with the coding tool that they already use, such as Codex, Cursor, GitHub Copilot or Claude Code. Each tool has its own files, but two open formats are read by most of them: `AGENTS.md` for instructions, and Agent Skills (`SKILL.md`) for procedures. Claude Code reads neither at its default paths: it needs `CLAUDE.md` and `.claude/skills/`.

## Decision

- **Every rule lives in an open format.** `AGENTS.md` (at the root, and in an area such as `adr/`) holds the instructions. `.agents/skills/<name>/SKILL.md` holds each procedure. A file for one tool only never holds a rule; it only points to one.
- **`CLAUDE.md` is a one-line `@AGENTS.md` shim**, next to each `AGENTS.md`, so Claude Code loads the same text. A nested `AGENTS.md` without its shim never loads in Claude Code.
- **`.claude/skills/` is a committed copy of `.agents/skills/`.** `bun run agents:sync` (`scripts/sync-agent-skills.ts`) writes it, and `bun run agents:check`, part of `bun run check`, fails when the copy drifts. A fresh clone works in Claude Code with no extra step.
- **The delegated checks are skills:** `scout-patterns`, `check-adrs`, `check-docs` and `run-checks`. Any tool can follow them. In Claude Code, `.claude/agents/` keeps four thin subagents (`pattern-scout`, `adr-checker`, `docs-checker`, `validate`) that only tell a subagent to follow the skill, so its reading stays out of the main context.
- **Enforcement does not depend on the tool.** Lefthook git hooks and CI run every check. `.claude/settings.json` (permissions, format-on-edit hooks) is comfort for Claude Code only.
- **No file for any other single tool** (no `GEMINI.md`, `.cursor/` or `.codex/`). A tool that reads `AGENTS.md` and `.agents/skills/` needs nothing more.
- ADRs live in `adr/`, indexed as one-line rows in the root `AGENTS.md`, and are living documents updated in place. Code patterns live in `docs/standards/`.

**Rejected alternatives:**

- **Symlinks from `.claude/skills/` to `.agents/skills/`.** Git on Windows checks a symlink out as a small text file by default, so Claude Code on Windows would find no skills.
- **A gitignored `.claude/skills/` mirror.** A fresh clone would have no skills in Claude Code until someone ran the sync.
- **Skills only in `.claude/skills/`** (the first version of this ADR). Only Claude Code reads that path, so other tools got no procedures.

## Consequences

**Positive:**

- One canonical copy of each rule and procedure, readable by most coding tools.
- The always-on context stays small, because procedures load on demand as skills.

**Trade-offs and follow-up:**

- A skill edit needs `bun run agents:sync`; `bun run check` and the pre-push hook catch a forgotten one.
- A clone of this repository inside a vault (`Projects/<project>/repos/eva-<n>/`) has a `CLAUDE.md`, so a Claude Code session in it loads only this repository's docs, not the vault and project `AGENTS.md` files above it (spike S3). This matches opening the clone by hand, which is what Project mode wants.
- If the number of skills grows enough that their descriptions bloat startup context, mark the human-invoked ones as not model-invocable.
