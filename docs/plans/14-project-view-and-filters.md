# Plan: Project view and project search filters (issue #14)

This file holds the working plan of the pull request. It leaves the repository before the merge.

## Goal

Finish Project mode in the web UI, and give every front end the same project search.
The owner's sketch (`docs/mockups/project-mode.png`, removed in d001e7f) shows the target.

## Current state

- `ProjectView.tsx` shows only the newest chat of a clone. "Start a chat" shows only in an empty clone.
- The API returns `warnings` for each project, but no front end shows them.
- `searchProjects` matches words in the id and the title, not in the tags.
- `GET /api/projects` takes `text`, `status` and `tag`. The web UI sends `text` and `status`.
- `eva projects` and Telegram `/projects` send free text only.
- A turn keeps one `toolCount`. The answer shows "N tools" in both modes.
- The background tasks panel is in `AssistantView.tsx` only. It shows the tasks of every session, and it is hidden on a phone.

## Steps

1. Core search: the text search also matches tags.
2. Core search: one parser turns free text with filter words into a `ProjectQuery`. The API and Telegram use it.
3. CLI: `eva projects` takes the filter words. It shows the tags and a warning mark.
4. Telegram: `/projects` takes the same filter words. It shows the status and the title.
5. Web: a tag filter next to the status filter.
6. Web: a warning badge on a project with warnings, with the warnings as its text.
7. Web: a clone lists all its chats. A "New chat" button starts another chat in the clone.
8. Engine events to turn record: each turn keeps its activity counts (commands, other tools, background tasks).
9. Web: the activity chips under each answer read like "3 commands, 1 tool, 2 background tasks", in both modes.
10. Web: a shared background tasks panel shows in both modes. It lists only the tasks of the chats in view. On a phone, the background tasks chip opens it.

## Gaps

- G1. Where does the list of a clone's chats go?
- G2. What filter syntax do the CLI and Telegram take?
- G3. How does the core tell a "command" from other tools, for every engine?
- G4. How do the background tasks reach the phone, and how does a turn know its tasks?
- G5. Which control picks a tag in the web UI?
- G6. How does the warning show?

## Decisions

Three agents researched each gap (two mid-tier, one upper-tier). They agreed on each point below. No gap needs the owner.

- **G1. Chat list.** The sidebar gets a third level: project, clone, chats. The selected clone lists its root chats, newest first, with a "New chat" button. Picking a clone opens its newest chat, as today. A new chat opens at once and closes the drawer. An empty clone keeps "Start a chat in this clone" in the main pane, so a phone can start the first chat without the drawer. Evidence: `AssistantView.tsx` selection pattern, the default title "New chat" in `session-manager.ts`.
- **G2. Filter words.** The free text takes `status:<status>`, `tag:<tag>` and `#<tag>`. `status:any` removes the status filter. One function, `parseProjectQuery` in `project-catalog.ts`, reads them. `GET /api/projects` runs it on `text`, and an explicit `status` or `tag` parameter wins. So `eva projects` keeps sending `text`, and Telegram calls the parser in the same process. Reasons: Telegram has no option syntax, one grammar serves both, and the CLI is a thin HTTP client. The CLI and Telegram keep no default status: a silent filter would hide projects that they list today. A word with an unknown status stays a plain search word.
- **G3. Commands.** `tool_started` gets a required `category: "command" | "tool"`. Each adapter sets it with one shared function, `toolCategory`, in `src/shared/outward-actions.ts`. That file already matches the shell tool of both engines without case. The core keeps no engine tool names (`src/engines/AGENTS.md`: map structured fields in the adapter). The turn record keeps `toolCount` as all tools, and adds `commandCount` and `taskCount` with a default of 0, so old files still load (lesson 69).
- **G3. Chip text.** "3 commands, 1 tool, 2 background tasks". A zero part is left out. The sketch's "2 turns" is dropped: the SDK `num_turns` counts model round trips, pi has no such field, and Eva already uses "turn" for one message and its answer.
- **G4. Background tasks.** One `TasksPanel` component serves both views. It lists only the tasks of the chats in view: the open chat and its forks. On a wide screen it is the side panel in both modes. Under each answer, the "N background tasks" chip is a button that opens the same list in a dialog, so a phone reaches it. Tasks stay live only: Eva cannot keep a stored state true. A task that is still running when the turn ends gets no end event; issue #70 covers that.
- **G5. Tag control.** A `<select>` "Tag" after the status select, with "Any tag". Its options come from one fetch of all projects, so the tags of closed projects show too. It hides when no project has a tag. Reasons: it copies the status select, a phone gets 44 px for free, and it offers only real tags.
- **G6. Warnings.** A project with warnings gets a "N warnings" badge in the list. When the project is open in the list, the warning text shows under its clones, as a list. This reaches the phone without hover, and it needs no clone. `eva projects` prints the warnings under the project. Telegram marks the project with a ⚠ and prints the warnings. A project with no front matter or broken YAML stays out of the list: that is a contract change, out of scope.
