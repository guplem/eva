# Plan: the v3 vault template (#772)

A new vault gets the final v3 template: the root map, a two-line README, a slim About me, `Life/Health/Allergies and Diet.md`, one `AGENTS.md` with format rules in each `Life/` folder, `.eva/AGENTS.md`, and `.eva/vault-structure.json` with version 3. Setup's folder list gets the new purposes of `Life` and `Projects`. Existing vaults get only `.eva/AGENTS.md`, through template alignment.

## Motivation

With no clear place, an agent guesses, and one fact ends up in two places (decisions.md: "Eva must never doubt where to store or where to look"). The owner approved the texts as they are. The blocking issues (#767, #768, #769, #770, #771) already changed the behaviour that this text describes, so a new vault never gets text that Eva contradicts.

## Design

- **Template files.** Each file of the issue's "Template files" section is written with its exact text: `templates/vault/AGENTS.md`, `README.md`, `Life/About me.md` (only the `work` comment changes, to name the `period` key that #770's reader and the `about-me` skill use), `Life/Health/Allergies and Diet.md` (already equal), the eight `Life/<folder>/AGENTS.md`, and `.eva/AGENTS.md`. `.eva/assistant.md` stays as #771 wrote it (equal to the issue's block).
- **`vault-template.ts`.** Imports each new file as text. `vaultTemplateFiles()` adds the eight `Life/` rule files as plain files and `.eva/vault-structure.json` = `{ "version": 3 }`. `.eva/AGENTS.md` joins `templateParts`.
- **Template alignment.** `PartKind` gets `"guide"`. `describePath()` matches the exact path `.eva/AGENTS.md` first and names it `.eva`. `kindWords` gets `guide: "guide"`, so the alert says "guide .eva".
- **Setup's folder list.** `vaultFolders` keeps one entry for each root folder. `Life` and `Projects` get the purposes of assumption 6.
- **Cleanup.** Delete `templates/vault/Notes/.gitkeep` and `templates/vault/Projects/.gitkeep`. The `.gitkeep` loop still gives a new vault its empty `Projects/`.
- **Rules.** `src/core/vault/AGENTS.md` gets two rules: `.eva/AGENTS.md` is a template part; a change to the root `AGENTS.md` or to a `Life/` rule file of the template needs a matching `vault-upgrade` CHANGELOG entry (#773).
- **Tests.** The template file list, the map text, the notes language line, the part name and kind, a new vault running every vault migration with no template file changed, and frozen copies of the old map text in the migration tests that read the live template.

## Gaps and decisions

The owner is away. Each decision follows his intentions (decisions.md, ROUND2.md), with its reason.

1. **Only `.eva/AGENTS.md` is a template part.** Reason: ROUND2 R2. It describes only Eva's folder, so it is true in every vault.
2. **The eight `Life/*/AGENTS.md` are plain new-vault files.** No "folder rules" kind, no version gating. Reason: R2; an Eva update never changes a vault's structure.
3. **The part kind is "guide" and its name `.eva`.** Reason: assumption 5 of the issue, and R2 ("its name `.eva`"). A new kind is one entry in `kindWords`.
4. **The structure version lives in one constant, `vaultStructureVersion = 3`, in `vault-template.ts`.** No code reads the file yet. Reason: assumption 4; #773 later takes the number from its CHANGELOG, so the number keeps one home.
5. **The migration record of a new vault** is #771's duty (`.eva/migrations.json` with only `2026-10-20-move-assistant-personality`). This branch merges #771 before review, and a test checks that every vault migration leaves each template file unchanged.
6. **About me keeps what merged code needs:** `pinned: full`, the empty `summary:`, and `work` with a `period` key. Only the `work` comment changes. Reason: the brief; the issue's block already says so.
7. **No version gating, no damaged-file rule, no re-reads.** Reason: R2 drops them.
8. **Migration tests that read the live template** get a frozen copy of the text they expect, as the migrations themselves freeze it. Reason: issue notes; the new map has no "A project is one of three types:" line.
9. **Captures.** Setup's folder list changes two purposes. The web setup page shows them, so it gets a before and after capture with the demo data. The Template alignment card only gains one row of data, so no capture.
10. **The template's Markdown is out of Prettier** (`templates/vault/**/*.md` in `.prettierignore`). Prettier pads each table to its widest cell, which adds about 6,000 spaces to the root map that every chat reads, and changes the approved text. Reason: small prompt, exact approved text.
