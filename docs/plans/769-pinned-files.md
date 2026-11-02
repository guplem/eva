# Plan: pinned files (#769)

Any vault file can carry `summary:` and `pinned: full | summary | false`. Eva builds one pinned block at the first turn of each Assistant chat, in place of the projects block.

## Motivation

Eva must know the open cases, the open period, the active projects and a few notes that the person marked, without a search. The prompt must stay small, and the block must stay the same for the whole chat, so the prompt cache holds (lesson 40).

## Design

- `src/core/modes/pinned-files.ts` finds the candidates:
  - The projects come from the project catalog, as today. Each also gives `pinned` and `summary`.
  - Eva reads `Life/Cases/*/Case.md` and `Life/Periods/*/Period.md` directly, outside the walk budget.
  - One breadth-first walk finds the manual pins. It reads `.md` files only, and only their head (8 KB). It skips hidden folders, the root `Scratch/`, `Projects/*/repos/`, links, secret files and encrypted files. It has an entry budget and a byte budget.
- `src/core/modes/pinned-block.ts` orders the candidates, applies the caps and writes the block. It replaces `projects-block.ts`.
- `AssistantPreparer` keeps the block in `promptBySession`, as it kept the projects block. `describe()` shows "Your pinned files".
- A frozen vault migration, `2026-11-02-pinned-files`, writes `summary` into each vault project and turns each `> Important:` line into `pinned: summary`.
- `Project.description` reads `summary` first, then the first paragraph. So the project page and the block show the summary with no other change.
- The New project form writes `summary:` from the first paragraph of the description.

## Gaps and decisions

Each decision follows the issue's assumptions unless it says otherwise.

1. **Line format.** `- <title>, \`<path>\` (<kind>, <status>) [<flag>]: <summary>`. The title is for projects only. The kind is `project`, `case`or`period`, from the fixed path. Reason: assumption 6 asks for the path, the kind, the status, the flags and the summary in one line. The project id stays visible in the path, so `eva work <id>` still works.
2. **"1 day", not "1 days".** The flag says `DEADLINE in 1 day` and `passed 1 day ago`. Reason: the owner wants human text. The base prompt names only the words `DUE` and `DEADLINE`, so the prompt and the block stay aligned.
3. **Old `> Important:` form.** The reader treats the line as `pinned: summary` only while the vault record lacks the new migration. Reason: the same pattern as `withPersonality` in `assistant-mode.ts`. After the hub migrates, the line means nothing.
4. **Dedupe.** A file with a `pinned` value is a manual pin, wherever it was found. The status part skips any file with a `pinned` value. So a manual pin that the walk missed still shows by its status when it has one. Reason: robust and simple.
5. **A project in an extra root** with `pinned: summary` or `full` shows as a summary line in the projects part. `pinned: false` hides it. Reason: the walk sees only the vault; one rule for both roots would need a second walk.
6. **Full file size.** Eva reads a full file only up to 64 KB. A larger file cannot fit the cap of about 8,000 characters, so it falls back to its summary line. Reason: bounded reads in the core.
7. **"Today" for the flags** is the date in `timeZone`. Eva already passes "UTC" when the setting is empty. Reason: no change of the setting's default in this issue.
8. **The migration logs nothing.** `MigrationContext` has no logger. A file whose new header would not parse stays unchanged, so nothing is lost. Reason: adding a logger to every migration is outside the scope.
9. **A note with no title heading** can also carry the `> Important:` line as its first line. Reason: Obsidian notes often take their title from the file name.
10. **Caps.** 25 summary lines and 8,000 characters (about 2,000 tokens) of full content. Over a cap, the block ends with "N more not shown".
11. **The About me template** gets no `pinned: full` here: #770 owns it.
