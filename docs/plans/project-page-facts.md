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

1. **Move "New clone" out of the header** into the empty card at the end of the clones grid. One button per job (`AGENTS.md`: "Do not add a second component for the same job"). Two buttons named "New clone" would also make the e2e locator ambiguous. The sidebar context menu keeps its own item.
2. **Show the facts that the Details editor edits:** status, created, tags and repositories. Hide a missing value. Do not show `extra` or `legacyId`: no page shows them, and `extra` is arbitrary YAML.
3. **Repository link:** `repositoryWebUrl` builds `https://host/path` from the cleaned label, and never keeps a token. A local path gives null and stays plain text. The link opens a new tab with `target="_blank" rel="noreferrer"`, as every external link in the client does.
4. **Files link:** a plain `<a href={fileAddressOf(...)}>` in the same tab, as FilesView links folders. A project in an extra root (`projectRoots`) lives outside the vault, so the Files page cannot open it. The core adds `vaultFolder` to `Project`: `Projects/<name>` for a vault project, null for an extra root. The link shows only when it is not null.
5. **Show the facts card always.** The facts and the links hold for a project with clones too. The card replaces the current tags row, so each fact has one place. The empty clone card does not take the `clone-card` class, because the e2e test counts those cards.
