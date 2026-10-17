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
2. Core search: one parser turns free text with filter words into a `ProjectQuery`. The CLI and Telegram use it.
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

To be filled in after the gap research.
