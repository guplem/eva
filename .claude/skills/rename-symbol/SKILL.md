---
name: rename-symbol
description: Rename or refactor a symbol safely by searching every naming-case variant across code, tests, docs, configs, and JSON. Use when renaming any identifier so no reference is missed.
---

# Rename a symbol safely

When you rename or refactor any symbol, search **all** naming variants (camelCase, PascalCase, snake_case, kebab-case, UPPER_CASE) across the whole project (code, tests, docs, configs, and JSON), not just the obvious code references. A missed variant in a config key or a data file is the usual cause of a rename that compiles fine but breaks at runtime.

Extra traps in this repo:

- **No generated files exist yet.** Every reference is hand-written, so search finds them all.
- **Persisted and wire names are a schema.** Config keys (`config.json`), the session record fields (`state/sessions.json`), event `kind` values, and `EvaErrorCode` values live in state files on people's machines and cross the local API to every front end. Renaming the TypeScript symbol is safe. Renaming the stored or sent string breaks existing files and clients: read the old name tolerantly, or drop the old format on purpose (lesson 54), and say so in the PR.
- **Snake_case and kebab-case variants matter here.** Event kinds and error codes are snake_case strings (`turn_finished`, `config_invalid`); file names are kebab-case (`project-id.ts`). Search those forms, not only camelCase.
- **Registration points must change together.** Paths in `.dependency-cruiser.cjs`, `knip.json`, `stryker.config.json`, `bunfig.toml`, and `package.json` (`scripts`, `bin`); CLI command names (plan §8.1) and Telegram commands (plan §8.2).
- **The docs name symbols too.** Update `docs/standards/`, the ADRs, and `AGENTS.md` in the same change. A name in `docs/plan.md` is part of the approved design: report the rename to the owner instead of editing a plan decision.
