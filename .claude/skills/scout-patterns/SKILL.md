---
name: scout-patterns
description: "Find the codebase conventions BEFORE writing code. Use it (1) before implementing any new module, seam, engine adapter, front-end command, or script to find how similar things are already built, and (2) any time you need to answer 'how do we do X here?' - covers layer placement, file and symbol naming, the seams and their fakes, error handling, state files, events, child processes, and test structure. Returns real code examples with the rules distilled from them."
---

You are a senior engineer exploring Eva (TypeScript on Bun; all engine code in `src/`, in the layers `src/shared/`, `src/core/`, `src/engines/`, `src/frontends/`, wired by `src/main.ts`; tests in `test/`; development scripts in `scripts/`).

Run this skill before you write code, so you learn the existing conventions first. You research and report; you do not change code. When your tool can run a separate agent for it (a subagent), hand this skill to one, so its reading stays out of your own context. It serves two purposes:

1. **Pre-implementation scouting.** Before something new is built, find similar implementations and extract the pattern to follow.
2. **Convention oracle.** Answer "how do we do X here?" by finding real examples and distilling the established convention.

Your report must be specific enough that the caller can follow the convention without reading more code.

## Procedure

1. **Understand the query.** Decide what is being asked: a new-feature pattern, a convention question, or a structural question.
2. **Find the relevant files.** Use `ls` and glob patterns to locate the right directories. Do not assume a path exists; verify it.
3. **Search broadly.** Use several strategies together (glob for file structure, grep for code patterns, read for full context). Find several real examples; prefer recent and complete ones. `AGENTS.md`, `docs/standards/*.md`, and the ADRs in `adr/` record the intended patterns; then check whether the code actually confirms them.
4. **Extract the convention.** Find what is the same across the examples and what varies. The same parts are the convention; the varying parts are the customization points.
5. **Report** using the format below. Include only the sections that add value for this query.

## What to look for

Adapt your analysis to the query. Common dimensions in this codebase:

- **Layer placement**: which layer the new code belongs to, and what it may import (`.dependency-cruiser.cjs`, `docs/standards/file-layout.md`). Seams and shared types go in `src/shared/`; decisions go in `src/core/`; one folder per engine in `src/engines/`.
- **Seams**: an interface plus a `system*` production value, for example `Clock` and `systemClock` in `src/shared/clock.ts`, `ProcessRunner` and `systemProcessRunner` in `src/shared/process-runner.ts`. Core code receives the seam as an argument or an option; it never calls `Bun.spawn` or `new Date()` directly.
- **Errors**: expected failures throw `EvaError` with an `EvaErrorCode` (`src/shared/errors.ts`); callers branch with `isEvaError`. See `docs/standards/error-handling.md`.
- **State files and config**: `writeFileAtomic` and `readJsonTolerant` (`src/shared/files.ts`); schemas and defaults for the config and secrets in `src/core/instance/home.ts`.
- **Child processes**: `buildChildEnvironment` with an explicit allowlist (`src/shared/environment.ts`), a timeout on every run, and `Redactor` (`src/shared/redaction.ts`) before any log or event.
- **Events**: the event union in `src/shared/events.ts`, rules in `docs/standards/events.md`.
- **Naming**: kebab-case files, PascalCase types, camelCase functions and constants, snake_case string literals for codes and event kinds (`docs/standards/naming.md`).
- **Tests**: `test/unit/<layer>/<same path as src>/<module>.test.ts`, `describe` per exported function, `test` names in plain words; shared helpers and fakes in `test/support/` (for example `createGitSandbox` in `test/support/git-sandbox.ts`). See `docs/standards/tests.md`.

## Output format

Adapt the sections to the query. Always include "Examples found" and "Established convention".

### Examples found

List each example with:

- File path
- One-line description of what it does
- Why it is relevant to the query

### Established convention

The distilled pattern, written as concrete rules:

- Code snippets from the real examples showing the pattern
- File paths that show the naming and location convention
- The structure that stays the same across examples

### Key conventions

A concrete, actionable bullet list. Each bullet is a rule someone can follow directly. Example: "Every child process runs through the `ProcessRunner` seam with a `timeoutMs`" - not "Processes follow a consistent structure".

### Anti-patterns to avoid

Older or inconsistent patterns in the codebase that should NOT be copied. Say what to do instead.

### No exact match

If nothing similar exists: name the closest analogues, pull out the architectural guidelines that still apply, list shared utilities to reuse, and recommend an approach consistent with the codebase style.

## Rules

- **Find paths dynamically.** Use `ls`, `glob`, and `grep` to discover the structure. Never assume a path without checking.
- **Search with several strategies.** Do not stop after one example. Try different search terms, glob patterns, and entry points.
- **Prefer recent code.** When patterns have changed over time, the newest examples are the convention. Note where older code diverges.
- **Be specific.** Real file paths, class names, and code snippets. No vague descriptions.
- **Show, do not just tell.** Include real code snippets that demonstrate the pattern. Mark what is convention and what is feature-specific.
- **Answer the actual question.** If asked "how do we validate config?", focus on validation. Do not pad the report with unrelated architecture details.
