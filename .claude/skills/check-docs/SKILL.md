---
name: check-docs
description: "Documentation drift detector, run AFTER implementation. It checks every place documentation lives - code comments, README.md, AGENTS.md, ADRs, docs/standards/, and the design docs in docs/ - against the code, and fixes what is now stale. Use after a change that could affect documented content (features, commands, structure, patterns, counts). The source of truth is always the code."
---

You are the documentation consistency checker for Eva. You run after code changes. You verify that every place documentation lives still tells the truth, and you fix what does not. You are the drift check across the whole documentation surface, so nothing that describes the code silently falls out of date.

## Where documentation lives (check all of these)

- **Code comments** in the changed files and the files they touch: a comment that describes behavior the change altered is now wrong. Comments often cite a plan section or a lesson number; check that the citation still fits.
- **`README.md`** at the root (human-facing: what Eva is, status, how to run from source).
- **`AGENTS.md`** at the root (its content loads through the one-line `CLAUDE.md` shim), and `adr/AGENTS.md`.
- **ADRs** in `adr/`, and the ADR index table in the root `AGENTS.md`.
- **`docs/standards/`**: one file per code pattern, plus its index `docs/standards/README.md`.
- **`docs/plan.md`** and its companions (`intent.md`, `lessons-from-v1.md`, `spikes.md`, `review-2026-10-14.md`, `owner-todo.md`). The plan is the approved design: never change a decision in it. Fix only a fact that the code proves wrong (a file name, a command), and report any real conflict between the code and a plan decision to the caller instead of editing.
- **Skills** in `.agents/skills/`, when a command, path, or check sequence they name changed. Edit only `.agents/skills/`, then run `bun run agents:sync`: `.claude/skills/` is a generated copy.

You verify and fix drift. You do not author new ADRs or decide new decisions: that is the **check-adrs** skill in maintain mode. If a change introduced a new pattern that has no ADR, note it for the check-adrs skill rather than writing the ADR yourself.

## When to run

- After you add, remove, or rename a module, a seam, or a layer folder under `src/`.
- After you change a `package.json` script, a config file (`bunfig.toml`, `tsconfig.json`, `eslint.config.js`, `.dependency-cruiser.cjs`, `knip.json`, `stryker.config.json`, `lefthook.yml`), or a CI workflow.
- After you change the event union, the error codes, the engine port, or the session record.
- After you change a CLI command, an exit code, the home folder layout, or a config key.
- After you change a test convention (location, support helpers, fixtures).

## Procedure

1. **Find the scope.** `git diff --name-only HEAD` and `git diff --name-only --cached`, or the scope the caller gave you.
2. **Map the changes to documentation areas** using the table below.
3. **Discover the doc files dynamically** (glob for `AGENTS.md`, nested `CLAUDE.md`, `README.md`, `adr/*.md`, `docs/**/*.md`, `.claude/**/*.md`). Do not assume the list.
4. **Cross-reference against the code, never against other docs.** Check that file paths point to files that exist, names match the code exactly, command tables match the real scripts, counts are current, comments match the behavior they describe, and the ADR index matches the `adr/` folder.
5. **Fix directly**, matching the style and density of the text around each fix.

## Change-to-documentation mapping

| Change in                                                                  | Check                                                                                                          |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `package.json` scripts                                                     | `AGENTS.md` Commands table, `README.md`, `.agents/skills/run-checks/SKILL.md`, `.claude/settings.json`         |
| `bunfig.toml`, `stryker.config.json`                                       | `AGENTS.md` Gotchas and TDD section, `adr/0009-layered-testing-strategy.md`, `docs/standards/tests.md`         |
| `.dependency-cruiser.cjs`, a new layer folder                              | `AGENTS.md` Architecture, `adr/0005-layers-enforced-by-dependency-cruiser.md`, `docs/standards/file-layout.md` |
| `src/shared/errors.ts`                                                     | `docs/standards/error-handling.md`                                                                             |
| The event union in `src/shared/`                                           | `docs/standards/events.md`, plan §4.6 (report a conflict; do not edit the plan's decision)                     |
| `src/shared/` seams (clock, process runner, files, environment, redaction) | `AGENTS.md` Rules, `docs/standards/tests.md`, `.agents/skills/scout-patterns/SKILL.md`                         |
| `src/engines/`                                                             | `adr/0006-engines-connected-directly.md`, `adr/0007-assistant-and-project-modes.md`                            |
| `src/core/vault/`                                                          | `adr/0008-eva-owns-vault-sync.md`                                                                              |
| `src/frontends/cli/`, `src/main.ts`                                        | `README.md` run section, `AGENTS.md` Commands                                                                  |
| `test/` layout, `test/support/`                                            | `docs/standards/tests.md`, `docs/standards/file-layout.md`                                                     |
| `scripts/check-public-content.ts`, `lefthook.yml`, `.github/workflows/`    | `AGENTS.md` Gotchas and Git Workflow, `adr/0002-public-engine-private-vault.md`                                |
| `adr/`                                                                     | The ADR index in `AGENTS.md`                                                                                   |

## Output format

```markdown
# Documentation check report

## Summary

- **Scope:** <what triggered the check>
- **Files checked:** N
- **Issues found:** N | **Fixed:** N

## Changes made

### <file path> -- <short description>

- **What was stale:** <the specific mismatch>
- **Fix applied:** <what changed>

## Plan conflicts (report only)

- <code fact> contradicts <plan section>: <one sentence>

## No issues found

Documentation is up to date for the checked scope.
```

## Rules

- **The source of truth is always the code, never the docs.** The one exception: a decision in `docs/plan.md` is not yours to change.
- **Be precise:** exact file paths and symbol names.
- **Only fix what is actually wrong.** Do not add new documentation sections; do not author ADRs.
- **Match the style of the text around each fix.**
- **Respect the one-home rule** from `AGENTS.md` (Documentation Organization): fix each fact in its home; never copy it into a second file.
- **Write no personal data.** The repository is public.
