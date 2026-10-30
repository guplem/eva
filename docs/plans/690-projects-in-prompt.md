# Plan: tell the assistant which projects the person develops and uses (#690)

## Goal

Eva's assistant prompt gets a block that lists the projects that the person develops (`active`) and uses (`in-use`). A new project status, `in-use`, marks a project that the person uses now.

## Steps

1. **The status `in-use`.** Add it to `ProjectStatus` and `statuses` in `src/core/projects/project-catalog.ts`, to the warning, and to `parseProjectQuery`. Add a `current` filter: `active` or `in-use`.
2. **The stored-name check.** Add the project statuses to `scripts/check-stored-names.ts`, so a later removal of a status fails the check.
3. **The comment after `status:`.** When Eva saves the status and the comment is `# idea, active, paused or closed`, write the new list.
4. **The block.** Add `src/core/modes/projects-block.ts`. It builds the block from the projects. `AssistantPreparer` reads the projects at the first turn of each chat, through a new `projects` option, and keeps the block with the rules in `promptBySession`. The chat details show the block as a part.
5. **The front ends.** Add the status to the API schemas, the details form, the Projects page chips and default filter, the status pill, the mention order and the CLI help.
6. **The docs.** Name the status in the built-in prompt, the vault template `AGENTS.md`, `docs/design/eve/reference.html`, and the guide.

## Gaps and decisions

- **How the "Current" filter reaches the core.** Decision: a filter value `current` next to the statuses. The API takes `status=current`, and the search text takes `status:current`, in the web app, the CLI and Telegram. One parser serves every front end, as for the other filter words.
- **The headings of the block.** The issue names the parts "Projects you develop" and "Projects in use". In Eva's prompt, "you" is Eva. Decision: the block says "Projects that the person develops" and "Projects that the person uses". The chat details title, which the person reads, is "Your projects".
- **The order of the projects in each list.** Decision: the catalog order, the newest first, as the Projects page shows them.
- **The tone of the "In use" pill.** The reference allows `ok`, `warn`, `bad`, `idle` and `live`. `ok` is Active, `warn` is Paused, `idle` is Idea and Closed. Decision: `live`, the accent colour, so "In use" differs from "Active" by colour, and by its glowing dot.
- **The chat details with an empty block.** Decision: the part is left out, as the block is.
- **The place of the widget lines of #692.** Decision: the block builder takes a list of parts, so #692 adds a third part with no change to the other two.
- **An older Eva.** It reads `in-use` as an unknown status and shows the warning "status must be idea, active, paused or closed". The PR says so. The change is not breaking: no stored name goes away.
