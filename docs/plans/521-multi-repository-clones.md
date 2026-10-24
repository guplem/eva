# Plan: one clone holds every repository of a project (#521)

## Why

A product often has more than one repository, such as a web app and its API, with one set of notes.
Today a Project chat sees only the first repository of `repos:`. The owner wants one chat to see all of them.

## Decisions from the issue

- A clone is `Projects/<id>/repos/clone-<n>/`, with one folder per repository of `repos:` inside it.
- A Project chat starts in `clone-<n>/`.
- A clone has one chat tree: one root chat and its forks.
- A new chat reuses a clone whose chat finished: fixed checks, then a model call, then Eva closes the chat and resets each repository to its default branch.
- "New chat here" goes away. The project page gets one "New chat" button, and Eva picks the clone.
- A dated `machine` migration deletes every old `repos/<repo>-<n>/` folder and its chats.

## Gaps and decisions

1. **Clone layout.** `repos/clone-<n>/<repository>/`. The repository folder is `repositoryName(url)`. Two URLs with the same name are refused with `project_invalid`.
2. **Old and new forms.** An old clone has a `.git` entry directly in its folder. A new clone has none. The listing and the migration use this test, so a repository named `clone` in the old form still counts as old.
3. **Trust.** `CloneOriginStore` keeps one record for each repository folder, as today for each clone folder. The chat is trusted only when every repository is trusted. Eva asks about each unknown repository in order, and stops at the first "no". A clone with no repository is untrusted.
4. **Closed chats.** A new session field `closed` (default `false`, so an old record reads as open). Eva closes the whole tree. `send`, `fork` and `retry` refuse a closed chat with the new error code `session_closed`. A closed chat keeps its history. A new event kind `session_closed` tells the front ends.
5. **When a clone is free.**
   - No reservation, no pull or push, and no active chat in the tree.
   - Every repository is clean (`git status --porcelain` is empty), and `git rev-list HEAD --branches --not --remotes` lists no commit. Each check runs inside the repository folder, never in `clone-<n>/`, so git never reads the vault above it.
   - A clone with no chat, or with a closed tree, needs no model call.
   - An open tree with no turn is not finished: the person may be about to write.
   - Otherwise the cheapest model reads the tree's turns and answers `FINISHED` or `NOT FINISHED`. A failed call counts as not finished. Eva keeps each verdict by the tree's turn count, so an unchanged chat costs one call.
6. **Reset.** For each repository: `git fetch`, read the default branch from `origin/HEAD` (with `git remote set-head origin --auto` when it is missing), then `git checkout -B <default> origin/<default>`. Git hooks stay off, as for Pull. No `git clean`, so the installed dependencies stay. Then Eva clones each repository of `repos:` that the clone lacks. A reset that fails leaves the clone closed. Eva tries the next clone, and the reset runs again on the next choice.
7. **Named clone.** `--clone`, the API's `cloneName` and a chat link refuse a clone whose tree is open, with `session_busy`.
8. **Agents and the vault.** A Project turn gets `GIT_CEILING_DIRECTORIES` set to the project's `repos/` folder, so `git status` in `clone-<n>/` stops before the vault.
9. **Failed clone.** When one repository fails to clone, Eva removes the whole `clone-<n>/` folder.
10. **Clone card.** One row per repository: name, branch, pull request, changes, sync, and Pull and Push. Pull and push name the repository: `POST /api/projects/<id>/clones/<clone>/repos/<repo>/pull` and `/push`.
11. **Migration.** `2026-10-24-clone-folders`, store `machine`. It deletes each old clone folder under `Projects/*/repos/`, and each session record whose start folder was one of them, with its forks. Without a vault it waits (`later`).
12. **Untrusted Claude Code chats** get `settingSources = ["user"]`, so Claude Code reads no project instruction file. This is today's behaviour. A fix needs a security decision, so it goes to a new issue.

## Steps

1. Clone listing and creation in the new form, with tests.
2. Closed chats in the session manager, with tests.
3. Clone reuse: fixed checks, model call, close, reset, with tests.
4. Trust for each repository, and the git ceiling, with tests.
5. API, web app and CLI text.
6. Migration, with tests.
7. Docs: root `AGENTS.md`, `templates/vault/AGENTS.md`, `docs/guide/reference.md`.
