# Plan: Eva's own skills ship with Eva, and the new base prompt (#771)

Part of #766. Issue: #771.

## Why

Eva's skills live in each vault today, so a person's copy never gets Eva's fixes, and a vault without `.eva/.claude-plugin/` loads no skill at all. The generic rules of Eva also live in the person's `.eva/assistant.md`, so an Eva update never improves them. The owner wants Eva's things in Eva, a short file of the person's own rules, and the vault untouched by an update.

## What changes

1. `templates/eva-core/`: the plugin `eva-core` with `.claude-plugin/plugin.json` and five skills: `eva-issue`, `eva-rules`, `about-me`, `schedule`, `vault-upgrade` (a stub). `about-me` and `schedule` move from `templates/vault/.eva/skills/` as they are now.
2. `src/core/modes/eva-core.ts`: writes `eva-core` to `<EVA_HOME>/engines/eva-core/`, and an override copy without the skills that the vault replaces.
3. `AssistantPreparer.pluginFolders()`: `eva-core` (or its copy) first, then the vault's `.eva/` when `.eva/skills/` exists. No manifest check. `describe()` uses the same function.
4. `templateParts` loses both skills. `TemplateAlignment` keeps a changed retired part's entry with `retired: true`, and removes an untouched old copy with no entry when its hash is in `templateHistory`.
5. A new vault gets the short `.eva/assistant.md`, no skill, and a `.eva/migrations.json` that records `2026-10-20-move-assistant-personality` as applied.
6. `withPersonality` goes.
7. `assistant-base-prompt.md` takes the approved text.
8. The rules in `AGENTS.md`, `src/core/modes/AGENTS.md` and `src/core/vault/AGENTS.md`, and `docs/guide/reference.md`, "Eva's rules".

## Gaps and decisions

The owner is away. Each decision follows his intentions (simple, one place per fact, Eva's things in Eva, existing vaults safe).

1. **Does Claude Code load a plugin folder with no manifest?** Yes. The Claude Code that SDK 0.3.300 ships loads a `--plugin-dir` folder with only `skills/` ("skills at its top marks it") and loads its skills. Tested by hand with a folder that holds only `skills/hello/SKILL.md`. So no vault migration writes the manifest. A new vault keeps its manifest.
2. **When Eva writes `eva-core`.** At the first use in each Eva process, which comes before any turn of that process. This is the same as "at start" for safety, and it needs no extra wiring. Eva rewrites the folder only when its files differ from this Eva's text. At the same moment she deletes the override copies of an earlier process, so a new Eva version writes new copies. No turn of an earlier process can still read them.
3. **The override copy.** Its folder is `<EVA_HOME>/engines/eva-core-without-<names>/`, with the overridden names sorted and joined by `-`. Eva writes it once, into a temporary folder, and renames it into place. She never rewrites it while the process runs.
4. **Which vault skill overrides.** Each folder in `.eva/skills/` that holds a `SKILL.md`. The folder name is the skill name, as in Eva's own skills.
5. **A failed write of `eva-core`.** Eva logs a warning, and the turn runs without Eva's skills. A broken engines folder must not stop every chat.
6. **A changed retired part.** Its entry stays with `retired: true` while the file exists. When the person deletes the file, the entry goes. `list()` already shows only current parts, so the Settings card skips it. The record reads the new field as optional (a stored format, read tolerantly). `scripts/stored-names.txt` gets the new name.
7. **The record of a new vault.** `vaultTemplateFiles` writes `.eva/migrations.json` with one entry: the id, the creation time and this Eva's version, as the runner writes them.
8. **Forward references in the approved prompt.** `.eva/vault-structure.json` (#772) and the `[Vault structure: …]` line (#773) do not exist yet. Both lines only tell the agent what to do when it meets them, so they do no harm before those issues land. Kept as approved.
9. **The prompt against merged behaviour.** The approved text in the issue already has the four changes for #769, #773 and #768, and R8. Checked against the merged code: the pinned markers (`<pinned-file path=…>`), `DUE`, `DEADLINE`, "N more not shown", the format block keys (`eva settings set` takes `language`, `timeZone`, `units`, `clock`, `weekStart`), `.eva/settings/settings.json`, the general type's start folder, `.eva/scratch/received/`. No text change was needed. #753 has not landed, so there is no line to keep.
10. **`eva-issue`.** The current procedure, with the three changes the issue lists. Eva fills `{{evaRepository}}` when she writes the skill.
11. **Tests that check the old prompt.** The base prompt test now checks the new sections and the one line on `eva-issue`. The procedure's checks move to a test of the `eva-issue` skill text.
12. **The manifest of `eva-core`.** Built in code, as the vault's manifest is: TypeScript types a JSON file as an object, even with the text import.
13. **The type check of `main`.** `main` fails it in `general-project-type.test.ts`. The pre-push hook blocks every push, so this branch carries the same two-line fix as #792. The merge stays clean.
14. **Captures.** No screen changes its layout. The chat details list more skills, and the rules page shows a shorter default text, so no capture is needed.
