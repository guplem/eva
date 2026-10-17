# Plan: repository setup report (#74)

This file is the working plan of the PR. The last commit of the PR deletes it; the PR description keeps the decisions.

## Goal

A project in the web UI shows, for each of its GitHub repositories, a report of how ready the repository is for autonomous agent work. Each item has a light (green, yellow, red, grey) and, when not green, a button that copies a fix request for a coding agent. The Eva repository is the reference and must score all green or grey.

## Decisions

- **G1 Data source:** `gh api --include` through the `ProcessRunner` seam, with Eva's git environment, as `describeClone` runs `gh`. Eva's own GitHub token reaches the vault only. Branch on the HTTP status, never on message text. When `gh` is missing or not logged in, the report is one grey line.
- **G2 Where:** the repositories are the project's front matter `repos` URLs. A "Repository setup" button under each open project shows the reports in the main area. A shared `githubSlug(url)` replaces the regex in `isTrustedByDefault`. A URL that is not on GitHub gets one grey line.
- **G3 Standard:** every folder of the reference's `.agents/skills/`, and one labels row: all reference label names present is green, some is yellow, none is red. Colors and descriptions do not count.
- **G4 Outdated skill:** the set of file paths and blob SHAs of the skill folder differs from the reference. A skill only in `.claude/skills/` is yellow too. A truncated tree makes the file items grey.
- **G5 Harness agnostic:** root `AGENTS.md`; each `CLAUDE.md` holds only `@AGENTS.md`; no harness-only rule files (`.cursorrules`, `.cursor/rules/`, `.windsurfrules`, `.clinerules`, `GEMINI.md`, `.github/copilot-instructions.md`); no `.claude/skills/`, `.claude/commands/`, `.claude/agents/`. Score: green items divided by the items that are not grey.
- **G6 Permissions (owner):** compare the stack-neutral allow rules of the reference's `.claude/settings.json` (non-shell tools, and shell rules for `git`, `gh` and read-only commands). All present is green, some is yellow with the missing list, no allow list is red. A broader rule such as `Bash(git *)` covers `Bash(git log*)`. The detail lists what agents may run.
- **G7 Security:** first read `GET repos/{slug}` (visibility, admin rights, merge settings, `security_and_analysis`). Each address has its own meaning:
  - private vulnerability reporting: `{enabled}`; 404 on a private repository is grey (public only).
  - Dependabot alerts: 204 on, 404 off; grey without admin rights.
  - Dependabot security updates: `{enabled}`.
  - secret scanning and push protection: `security_and_analysis`; `null` is grey.
  - code scanning: default setup `configured`, or a workflow that uses `github/codeql-action`; 403 is grey.
  - read-only workflow token: `default_workflow_permissions` is `read`; 403 is grey.
  - malware alerts: no API, always grey with a link to the settings page.
- **G8 Fix request:** one or two sentences that name the repository and start with a verb. Give the exact `gh api` write command when one exists, and link Eva's file on GitHub for a skill. "Copy all fixes" joins every request of one repository.
- **G9 Cache:** none. A report costs about 15 calls; the limit is 5,000 per hour. The reference is read once per request.
- **G10 CI:** a workflow whose `on` has `pull_request`. Required checks: `rules/branches/{default}` has `required_status_checks`, or `branches/{default}` has protection with checks. On a private repository, a missing gate is grey (rulesets need a paid plan there).
- **G11 Eva (owner approved, done):** a "Requirements for merge" ruleset requires the seven CI jobs and an up-to-date branch, and blocks force push and deletion. Dependabot security updates are on. In this PR: drop the `AGENTS.md` merge rule that the ruleset now enforces, and move the Eva-only traps of `rename-symbol` into `AGENTS.md`, so the skill is generic. Malware alerts need the owner in the settings page: an `owner` issue.
- **G12 Front ends:** web only. The core method is front-end neutral.

## Steps (one commit each, red-green)

1. `githubSlug` helper, shared with `isTrustedByDefault`.
2. The pure `evaluateSetup(reference, target)` with tests.
3. `readRepositoryFacts` over `gh api`, with a fake runner in tests.
4. `Eva.repositorySetup(projectId)` and `GET /api/projects/:id/setup`.
5. The web UI panel, with a browser test.
6. Eva: `AGENTS.md` merge rule and `rename-symbol` traps.
7. Delete this plan.
