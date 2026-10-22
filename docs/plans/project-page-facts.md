# Plan: project facts, quick links and a clones section (issue 392)

## Motivation

A project with no clones shows one sentence and an empty page. The person sees none of the project's facts and cannot reach the repository or the folder from the page. Eva works from a phone, so each link must work there too.

## Changes

1. `project-format.ts`: add `repositoryWebUrl(url)`. It turns a repository address into its web page address, or gives null when it cannot.
2. `ProjectPage.tsx`: add a `ProjectFacts` card under the header. It shows the status, the created date, the tags, each repository as a link, and a link that opens the project folder in Files.
3. `ProjectPage.tsx`: add a "Clones" section with a heading. Its grid always ends with an empty card that holds the "New clone" button.
4. `styles.css`: add the rules for the facts card and the empty clone card. Use the EVE tokens only.
5. Tests: unit tests for `repositoryWebUrl`; e2e checks for the facts card, the links and the empty card.

## Gaps

1. **The header "New clone" button.** Keep it, or move it into the clones section?
2. **The facts to show.** Which front matter keys show, and do unknown keys show?
3. **The repository link.** How does Eva build a web address from `https`, `ssh` and `scp` style addresses? Does the link open a new tab?
4. **The Files link.** How does the page open a folder in Files?
5. **The facts card with clones.** Does the facts card show only when the project has no clones, or always?

## Decisions

(Filled in after the gap review.)
