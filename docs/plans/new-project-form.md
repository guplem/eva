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

- G1. Reuse `createGitHubRepository` (`src/core/vault/github-repositories.ts`). It uses the GitHub API with the saved GitHub token, so no child process runs. The account of the token owns the repository. Add an `initialize` option (`auto_init`): a new repository gets a first commit, so a later clone has a default branch. The repository is private. Its name is the project slug, without the date. On a name clash, GitHub's message reaches the person.
- G2. Write the files only. The idle sweep commits and pushes them, as it does for `saveProjectDetails`.
- G3. Move the token refresh out of `checkGoogle` into `googleAccessToken`. The Drive step needs `drive` in `google.services` with the `full` access level.
- G4. Write the Drive link as a body line after the description. A new front matter key is a schema change, and the page would not show it.
- G5. Do not clone at once. The first Project chat clones `repos[0]`, as now.
- G6. Keep the project when an optional step fails. Return one result for each step, with the URL or the problem. Only a failure to write the folder fails the whole call.
- G7. Web app only. The web app reaches the phone. Schedules are also created only from the web app.
- G8. Reuse the sheet of `AddScheduleDialog` and its classes. Reuse `statusChoices`, `statusOf` and `splitWords` from `ProjectDetailsEditor`.
- The id and `created` use the configured time zone (lesson 68), through `wallClockOf`. Without a time zone, they use the machine's time zone, as vault setup does.
- An id that exists already fails with `project_invalid`. No new error code.
