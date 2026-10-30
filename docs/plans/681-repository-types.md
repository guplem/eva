# Plan: repository types and visibility (#681)

## Goal

The New project form asks for a repository type and its visibility. One type definition gives both the setup that Eva applies and the items of the setup report. Eva runs each fix that a command can do, and opens a chat only for the rest.

## Design

### The type definition

- `src/core/projects/repository-types.ts` holds the catalog. Each type has a name, a label, a short description, a default visibility, a "needs a GitHub login" flag, the reference repository (or none), and a function that gives the report sections.
- `standard`: the basic security items only. No reference repository.
- `vibe-coded`: the full report, with Eva's repository as the reference, as today.
- An optional `afterCreate` step runs after `POST /user/repos` and before the fixes. No type uses it yet. #688 (widget) uses it to push its template.
- The setup of a new repository is: create, `afterCreate`, run every direct fix of the report, then open one Project chat with the fix requests that are left. So the setup and the report come from the same items.

### Direct fixes

- `SetupItem` gets `directFix`: data that tells Eva what to run, or null. The server never trusts a fix that a client sends: the client names the items, and the server reads the report again.
- Kinds: a GitHub API call (settings, security), the labels of the reference (add the missing ones, delete GitHub's defaults), and a copy of reference files (the skills), as one commit through the Git Data API.
- A new seam, `GithubWrite`, runs `gh api -X <method> <path> --input -` with the JSON body on stdin.
- A direct fix that fails goes into the chat request, so the coding agent can try it, and the result lists the reason.

### Storage

- The front matter of the project's `AGENTS.md` gets `repo_types`, a map from each repository address in `repos` to its type name.
- `applyProjectDetails` drops the type of a repository that the person removes from `repos`.
- A repository with no known type has no report. Its card asks for the type.

### API

- `POST /api/projects` takes `repository: { type, visibility } | null`. It still reads the old `github: true` as standard and private.
- The result gets `setup`: the Project chat id, or null, and the reasons of the fixes that failed.
- `PUT /api/projects/<id>/setup/type` sets the type of one repository.
- `POST /api/projects/<id>/setup/fix` runs the direct fixes of the named items, or of all items, and gives the chat request that is left.

### Web

- The form: a "Create a GitHub repository" check, then a type and a visibility select. A warning for vibe-coded and private. A note for public.
- The report card: a type select. With no type, the card shows only the select.
- "Fix" on a direct item runs it and reloads the report. "Fix all" runs the direct fixes, then opens one chat when a request is left.

## Gaps and decisions

1. **Key name.** Decision: `repo_types`. It sits next to `repos`, and front matter keys use snake case (`legacy_id`).
2. **Which items are direct.** Decision: the GitHub settings (auto-merge, update branch, delete branch), labels, the security switches, and the skills when missing or outdated. A skill only in `.claude/skills/` stays a chat fix: it is a move. The ruleset stays a chat fix: it needs the CI job names. `SECURITY.md` and `.claude/settings.json` depend on the project, so they stay chat fixes.
3. **Where the direct file copy lands.** Decision: one commit on the default branch through the Git Data API. A ruleset that blocks the push makes the fix fail, and the chat gets the request.
4. **The setup chat.** Decision: a Project chat in a new clone (the same path as project work), with no report to an Assistant chat. The request asks the agent to open one pull request and merge it with auto-merge, as the standard says.
5. **Assumptions of the issue.** All six hold against the code. The type picker is on the report card. The form is the only way to create a project repository: the API is the only caller of `createProject`.
6. **Sub-agents.** The tool that runs this work has no sub-agent tool. The gap search and the reviews run in this session, and the PR says so.
7. **Breaking change.** Existing repositories lose the report until the person picks a type. The commit that does this is marked with `!`. No migration: the person decided it.
