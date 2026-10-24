# Plan: Smart, Balanced and Fast, with no "Default" model or effort

Issue: #550.

## Why

The person cannot see what "Default model" or a "Default" effort gives. The settings do not choose the model or the effort of a new chat. The person wants a simple interface: three tiers, and a default for each new chat in the settings.

## Decisions

Each one comes from the person (issue #550), or from the source named.

1. `ModelAlias` is `opus | sonnet | haiku`. A record keeps the alias (lesson 121). The interface names them Smart, Balanced and Fast (`modelTierName` in `src/shared/engine-port.ts`, so each front end uses the same words).
2. `effortLevels` is `low | medium | high | xhigh | max`. `TurnRequest.effort` is `EffortLevel | null`. Null sends no effort, so the engine keeps its own level. Model calls and a model with no effort send null.
3. `takesEffort(engine, model)` in `src/shared/engine-port.ts`: false only for Claude Code on `haiku`. The session manager sends null then, and the web composer hides the effort chip.
4. New settings in the vault: `engines.defaultModel` (default `opus`) and `engines.defaultEffort` (default `medium`). They replace `engines.claudeCode.defaultModel`, because the tiers apply to both engines.
5. `engines.pi.models` holds `opus`, `sonnet` and `haiku`. A null tier uses pi's own default. The old `default` entry fills each null tier.
6. Old values read tolerantly (`AGENTS.md`: a satellite can update before the hub migrates the vault):
   - `parseConfig` moves `engines.claudeCode.defaultModel` to `engines.defaultModel`, and `default` reads as `opus`. It fills the pi tiers from `engines.pi.models.default`.
   - A session record with model `default` reads as `opus`. Effort `default` reads as `medium`.
   - A schedule with an unknown model uses the settings' model, as before.
7. A dated migration (`2026-10-24-model-tiers`), for the vault and for the machine, rewrites the stored settings to the new form. The settings list keeps the old key for one release, so a satellite reads a vault that the hub did not migrate yet.
8. The core fills the model and the effort of a new chat from the live settings when a front end gives none. The web draft, Telegram `/new`, the CLI and schedules give none, unless the person picked one.
9. The CLI `--model` and the local API still accept `default` and read it as "the settings' model". No typed command breaks, so no change is breaking.
10. Checks and commit messages ran on `default`. They now run on `haiku`, the cheapest tier. In pi, a null `haiku` tier is pi's own default, as before.
11. The chip of a chat that answered shows "Smart · Opus 5.5".

## Gaps

None open. The person answered each question that changes what they get.

## Steps

1. Shared types and labels, the engine adapters, model calls and checks.
2. Settings schema, tolerant read, migration, the settings page.
3. Session records, the core defaults, the API, the front ends.
