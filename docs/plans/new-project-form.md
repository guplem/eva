# Plan: create a new project from a form

Issue: #313.

## Why

Eva lists projects, but she cannot create one. The person must make the folder by hand, with the right time in its name and valid front matter. That needs a computer, and a small mistake hides the project. A form on the web app closes that gap, and it works from a phone.

## What

1. **Core:** a `createProject` function in `src/core/projects/`. It builds the id with `formatProjectId`, writes `Projects/<id>/AGENTS.md` atomically, and refuses an id that exists.
2. **GitHub step (optional):** `gh repo create` through the `ProcessRunner`, private by default. The URL goes in `repos:`.
3. **Drive step (optional):** a Drive folder, made with Eva's own Google access token. The project file links to it.
4. **API:** `POST /api/projects`.
5. **Web:** a "New project" button on the Projects page opens the form. After the send, the new project opens.

## Gaps

- G1. How core runs `gh repo create`, and which account owns the repository.
- G2. How the new files reach the vault remote (sync).
- G3. How core gets a Google access token, and which setting allows Drive writes.
- G4. Where the Drive link lives: a front matter key or a body line.
- G5. Whether a new repository gets a first clone at once.
- G6. What happens when one optional step fails.
- G7. Whether Telegram and the CLI need the command too.
- G8. Which dialog component the form reuses.

## Decisions

To fill in after the research.
