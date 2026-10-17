# Plan: repository setup report (#74)

This file is the working plan of the PR. The last commit of the PR deletes it; the PR description keeps the decisions.

## Goal

A project in the web UI shows, for each of its GitHub repositories, a report of how ready the repository is for autonomous agent work. Each item has a light (green, yellow, red, grey) and, when not green, a button that copies a fix request for a coding agent. The Eva repository is the reference and must score all green or grey.

## Design

### Data

- **Source:** the GitHub REST API through `gh api`, run through the `ProcessRunner` seam with Eva's git environment. This is the pattern of `describeClone` (`gh pr view`).
- **Reference repository:** `guplem/eva`, its default branch. One constant, shared with `self-update.ts`.
- **One tree read per repository:** `GET repos/{slug}/git/trees/{branch}?recursive=1` gives every path and its blob SHA. Skills, harness files, hooks and workflows come from it, with no clone.
- **Repositories of a project:** the `repos` URLs of the project's front matter. A URL that is not on GitHub gets one grey line.
- **Cache:** the core keeps each repository's facts for 10 minutes. A Refresh button reads them again.

### Model (pure, in `src/core/projects/repository-setup.ts`)

- `RepositoryFacts`: what Eva read from GitHub, with `null` for each fact it could not read.
- `evaluateSetup(reference, target): SetupReport`: pure, fully unit tested.
- `SetupItem`: `section`, `label`, `state` (`good`, `warning`, `bad`, `unknown`, `not-applicable`), `detail`, `fixRequest` (text or null).
- The reader `readRepositoryFacts(slug, runner, environment)` turns `gh api` answers into facts. An HTTP 403 or 404 on an admin-only address becomes `null`, so the item is grey.

### Sections and items

| Section           | Item                                                                                                                                                       | Green                                          | Yellow                                     | Red                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------ | -------------------------------- |
| Development       | each skill of the reference's `.agents/skills/`                                                                                                            | same files, same blobs                         | files differ, or only in `.claude/skills/` | missing                          |
| Development       | each label of the reference                                                                                                                                | present                                        | color or description differ                | missing                          |
| Development       | git hooks                                                                                                                                                  | `lefthook.yml` or `.husky/`                    |                                            | none                             |
| Pull requests     | CI on pull requests                                                                                                                                        | a workflow runs on `pull_request`              |                                            | none                             |
| Pull requests     | required checks                                                                                                                                            | a ruleset or branch protection requires checks |                                            | none                             |
| Pull requests     | auto-merge, update branch, delete branch on merge                                                                                                          | on                                             |                                            | off                              |
| Harness agnostic  | `AGENTS.md` at the root                                                                                                                                    | present                                        |                                            | missing                          |
| Harness agnostic  | each `CLAUDE.md` holds only `@AGENTS.md`                                                                                                                   | yes                                            |                                            | content                          |
| Harness agnostic  | no harness-only rule files                                                                                                                                 | none                                           |                                            | e.g. `.cursorrules`, `GEMINI.md` |
| Harness agnostic  | no `.claude/skills`, `.claude/commands`, `.claude/agents`                                                                                                  | none                                           | present                                    |                                  |
| Agent permissions | see gap G6                                                                                                                                                 |                                                |                                            |                                  |
| Security          | private vulnerability reporting, Dependabot alerts, Dependabot security updates, secret scanning, push protection, code scanning, read-only workflow token | on                                             |                                            | off                              |

The Harness agnostic section also shows a score: the share of its green items.

### Private repositories

Features that GitHub gives free only to public repositories show grey on a private repository, with the reason.

### API and UI

- `GET /api/projects/:id/setup` (and `?refresh=1`): one report for each repository URL.
- `ProjectView`: a "Repository setup" button under each open project. The main area then shows each repository's report: sections, one line per item with a colored dot, the detail, and a Copy button. A "Copy all fixes" button copies every fix request of that repository at once.

## Gaps

- **G1** Data source: `gh api` or `fetch` with Eva's GitHub token.
- **G2** Where the report shows, and what "repository" means for a project.
- **G3** Which skills and labels count as standard.
- **G4** When a skill is "outdated".
- **G5** The harness-agnostic items and their score.
- **G6** What "agent permissions" checks, when permission files are harness-specific and stack-specific.
- **G7** The security items, private repositories, and malware alerts with no API.
- **G8** The fix request text.
- **G9** Rate limits and cache.
- **G10** How to detect CI and required checks.
- **G11** What the Eva repository itself should change to be the reference.
- **G12** Other front ends (Telegram, CLI).

## Steps (one commit each, red-green)

1. Shared reference constant, and the pure `evaluateSetup` with tests.
2. `readRepositoryFacts` over `gh api`, with a fake runner in tests.
3. `Eva.repositorySetup(projectId, refresh)` with the cache, and the API route.
4. The web UI panel, with a browser test.
5. Changes to the Eva repository from G11 that the owner approves.
6. Delete this plan.
