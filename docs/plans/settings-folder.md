# Plan: the vault's Eva settings move to `.eva/settings/` (#662)

## Goal

Group the person's Eva settings in one folder of the vault:

- `.eva/settings.json` becomes `.eva/settings/settings.json`.
- `.eva/chat-names.md` becomes `.eva/settings/chat-names.md`.

`.eva/assistant.md` and `.eva/skills/` stay: the engines load them.

## Decisions

1. **A vault migration copies each old file to its new place.** Id `2026-10-30-settings-folder`. Only the hub runs it. It copies an old file over the new one, because until the migration runs, the old file holds the newest value (see 3). Source: `src/core/migrations/AGENTS.md`.
2. **The old files stay in the vault for one release.** An older satellite reads only the old place. After the hub migrates, `vault_ahead` stops each older Eva from a write to the vault, but it still reads. So the old file keeps its settings working until it updates. A follow-up issue deletes the old files and the mirror.
3. **New code reads the old place until the migration runs, and the new place after.** The migration record says which. When the preferred file is missing, the read uses the other one. So a new satellite reads what an older hub writes, and nothing goes stale before the migration.
4. **Each save writes both places for one release.** So an older satellite reads the newest value. This follows `withOldVaultKeys` in `settings.ts`.
5. **The paths live in one module,** `src/core/settings/settings-folder.ts`, which `settings.ts` and `chat-namer.ts` use. The migration keeps its own frozen copy.
6. **Text for people and agents names the new paths:** the assistant base prompt, the web hint, `docs/guide/reference.md`.

## Gaps

None open. The rule in `src/core/migrations/AGENTS.md` and the pattern of #550 answer the compatibility questions.
