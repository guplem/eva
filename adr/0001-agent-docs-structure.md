# AGENTS.md map with Claude-Code-only skills, subagents, and ADRs

## Context

This repository started with the design documents in `docs/` and a CI setup, but no agent documentation. AI agents build most of the engine (plan §13), so the repository must carry its own rules. It adopts the owner's shared personal standard: a root `AGENTS.md` as the always-loaded map, on-demand skills, subagents for delegated checks, and living ADRs. The repo is developed with Claude Code only, so no multi-tool sync machinery is needed.

## Decision

- `AGENTS.md` at the repo root is the canonical, always-loaded map. `CLAUDE.md` is a one-line `@AGENTS.md` shim so Claude Code loads it. Tools that read `AGENTS.md` natively work without extra files.
- Areas that earn their own doc follow the same pattern: `<area>/AGENTS.md` holds the content, next to a one-line `<area>/CLAUDE.md` shim that makes Claude Code load it on demand when working in that area. A nested `AGENTS.md` without its shim never loads.
- Skills live committed directly at `.claude/skills/<name>/SKILL.md`. No `.agents/skills/` canonical tree, no gitignored mirror, no sync scripts.
- All skills are model-invocable (no `disable-model-invocation` frontmatter). The set is small, so the startup-context cost of their descriptions is low.
- Subagents live at `.claude/agents/<name>.md` (`pattern-scout`, `adr-checker`, `validate`, `docs-checker`).
- ADRs live in this single `adr/` directory, indexed as one-line rows in the root `AGENTS.md`, and are living documents updated in place. The folder's conventions live in `adr/AGENTS.md`, auto-loaded via its `adr/CLAUDE.md` shim.
- Code patterns live in `docs/standards/`, one file per pattern, linked from `AGENTS.md` (plan §13).
- `.claude/settings.json` holds the permission allow/deny lists and PostToolUse hooks.

**Rejected alternative:** no `CLAUDE.md` at all, as in the vault (plan §2.2). The vault avoids a `CLAUDE.md` so that Claude Code reads every `AGENTS.md` up the folder chain. The engine repository needs its own rules loaded at session start, and the shim does that with no duplicated text.

## Consequences

**Positive:**

- One canonical copy of each instruction; the always-on context stays small because procedures load on demand as skills.
- No sync scripts or mirrors to maintain.

**Trade-offs and follow-up:**

- A clone of this repository inside a vault (`Projects/<project>/repos/eva-<n>/`) has a `CLAUDE.md`, so a session in it loads only this repository's docs, not the vault and project `AGENTS.md` files above it (spike S3). This matches opening the clone by hand, which is what Project mode wants.
- Skills, subagents, and settings are Claude-Code-only surfaces. If another agent tool is adopted, move skills to a canonical `.agents/skills/` tree with a gitignored `.claude/skills/` mirror and a sync script.
- If the number of skills grows enough that their always-loaded descriptions bloat startup context, add `disable-model-invocation: true` to the human-invoked ones and introduce an `/invoke` chaining skill.
