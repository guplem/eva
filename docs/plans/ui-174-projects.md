# Plan: projects with filter chips, clone cards and a clear project chat header (issue #174)

Redesign the project list, the project page and the chat inside a clone, as in the "Project list and details" and "A chat in a clone" sections of `docs/design/eve/README.md`.

## Motivation

The project list hides everything in an accordion. The filters are drop-down menus, which take two taps on a phone. A clone shows only its name, and its branch shows only in the chat header. The EVE design gives each project a card, each clone a card with its branch, state and chats, and each project chat a header that says where it runs. Project mode stays a transparent wrapper: the design adds no prompt and no skill.

## What changes

- `src/core/projects/project-catalog.ts`: each project gets `description` (the first paragraph under its title) and `cloneCount` (the folders in `repos/`).
- `src/core/projects/clones.ts`: `describeClone` adds `changes`, the number of changed files from `git status --porcelain`.
- `client/project-format.ts` (new): pure helpers for the labels. Unit tested.
- `client/ProjectView.tsx`: the list with chips and cards, the project page with clone cards, the chat header.
- `client/Conversation.tsx`: a "Project" chip in the composer of a project chat.
- `styles.css`: pills, chips, cards, the amber banner, the phone list.
- `test/e2e/web-ui.spec.ts`: the new names and flow.

## Gaps and decisions

1. **The shell issue (#167) is not merged.** Decision: build on `main`, as the other page issues do. Keep the top bar, the Mode switch and the "Show the list" drawer. Touch only the project parts, so the shell PR merges with few conflicts.
2. **The "New" project button.** Eva cannot create a project today: no API, no command. The README says to build a missing feature only when it is small. A new project needs a folder, an `AGENTS.md` and a vault sync. Decision: leave the button out, and write the gap in the PR and the issue.
3. **"2 clones · 3 chats".** The list has no clone count. Decision: `discoverProjects` counts the clone folders with `listClones`, a cheap folder read. The chat count comes from the chats that the page already has: root chats whose `projectId` is the project. The line says "No clones yet" for zero clones, and drops the chat part for zero chats.
4. **The description.** Decision: the first paragraph after the `# ` title of `AGENTS.md`, outside a code fence, in plain text. A heading, a list, a quote, a table or a fence is not a description. No paragraph gives `null`, and the page shows nothing.
5. **The clone state pill.** Decision: `changes` is the number of lines of `git status --porcelain` (changed, staged and new files). The pill says "Clean" (green) or "N changes" (amber). A failed git call gives `null` and no pill. Commits that are not pushed do not count: the pull request chip covers that work.
6. **The filter chips.** Decision: a `group` named "Status" with four chips, and a `group` named "Tag" with one chip per tag. Each chip is a `button` with `aria-pressed`. A tap on the pressed chip clears that filter (any status, any tag). The status filter still starts at Active. A typed `status:` or `tag:` word wins, as before.
7. **How the pages connect.** Decision: a tap on a project card opens the project page in the main column. A tap on a chat in a clone card opens the chat. "New chat here" starts a chat in that clone and opens it. "New clone" adds a card and stays on the project page. The project title in the chat header is a button back to the project page. "Details" and "Repository setup" open their pages, each with a back button to the project page.
8. **The project page buttons.** The design shows "Details" (outline) and "New clone" (main). Decision: add "Repository setup" as a third, soft button, so the setup stays one tap away.
9. **Warnings.** Decision: the list card shows an amber "N warnings" pill. The project page shows the warnings in an amber banner, as a list named "Warnings of <title>".
10. **The phone.** Decision: when no project is open, the list is the page, with a large "Projects" title, the search, the chips and the cards. When a project is open, the list goes back to its drawer, and a "Back to the list" button in the header shows the list page again. No name of a new button contains "project", because the tests find the Mode button by the name "Project".
11. **Chat times in a clone card.** Decision: the time of the last turn, or the creation time. Today shows "09:05", the last 6 days show the weekday ("Mon"), and older chats show the day and month ("12 Oct").
12. **The chat header.** Decision: "<project> › <clone> · <branch>" under the chat title, the branch in monospace, then a "PR #N" chip and a "Project mode" chip. The title is the chat title. The composer shows a "Project" chip.
13. **A deleted chat.** Decision: when the open chat is gone, the page shows the project page again.
14. **The repositories.** Decision: chips with the globe icon and the URL without `https://` and `.git`. They are not links, because a repository can be a local folder.
15. **The design README.** Decision: remove the "Project clones as cards" row from the gap table, because this PR closes it.
