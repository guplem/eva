# Plan: edit project details from the web app (#43)

## Goal

The person changes a project's information from the web app, also from a phone.
The information lives in the project's `AGENTS.md`: the YAML front matter and the `# Title` heading.
The common fields are easy to fill and to clear. Every other part of the file is editable too.

## Steps

1. Core, pure: `src/core/projects/project-file.ts`.
   - `applyProjectDetails(text, details)` returns the new file text.
     It sets `status`, `tags` and `repos` in the front matter and the `# Title` heading.
     It keeps unknown keys, comments, key order, the body and the line endings.
     An empty list removes its key. An empty title removes the heading.
   - `checkProjectFile(text)` refuses a text whose front matter Eva cannot read,
     because the project would then disappear from the list.
   - `fileVersion(text)` gives a hash. A save sends the version that it read.
     A different version on disk means that someone else changed the file, and the save fails.
2. Core, `Eva`: `projectFile(id)` and `saveProjectDetails(id, input)` and `saveProjectFile(id, input)`.
   They write with `writeFileAtomic`. The idle sweep commits the change, as for `.eva/schedules.json`.
3. Errors: new `EvaErrorCode` values `project_invalid` (400) and `project_changed` (409).
4. Local API:
   - `GET /api/projects/:id/file` gives `{ text, version }`.
   - `PUT /api/projects/:id/details` takes `{ version, title, status, tags, repos }`.
   - `PUT /api/projects/:id/file` takes `{ version, text }`.
   Each save answers with the new `{ text, version }`.
5. Web: a "Project details" button under each project opens `ProjectDetails.tsx` in the main area.
   - A form: title, status, tags, repositories. Each list row has a remove button, and an add field.
     `created` shows as read-only text, because the folder name holds it.
   - A second part, "AGENTS.md", is a text area with the whole file and its own save button.
   - On a conflict the page says so and offers to load the new file.
   - After a save, the project list reloads.
6. Tests: unit tests for the pure module, for `Eva`, for the API routes, and one e2e test.
7. Docs: one line in `docs/guide/reference.md` for the new routes and the web feature.

## Gaps

- G1. Does a device login (a phone without the token) get the right to save? Settings limit a device login.
- G2. Can the person rename the folder, or change `created`? The vault layout is a contract.
- G3. How strict are tags and repository URLs?
- G4. Telegram and the CLI: in scope or not?
- G5. How to keep the YAML comments and order when Eva rewrites the front matter?

## Decisions

(Filled after the gap review.)
