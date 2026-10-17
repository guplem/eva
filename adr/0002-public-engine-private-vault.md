# Two repositories: a public engine and a private vault for each person

## Context

Wall-I v1 kept the personal notes and the server code in one repository. The notes autosave to `main` within seconds, and code needs branches, pull requests, and CI. A repository that autosaves to `main` cannot have a required-check ruleset (lesson 28). The owner also wants to share Eva with other people, and each person has their own notes.

Source: lessons 19, 28.

## Decision

- **Two repositories.** `guplem/eva` holds the engine: the core source, tests, CI, docs, and the base assistant prompt. Each person has one private vault repository (the owner's is `guplem/vault`) that holds only knowledge.
- **The engine is public from the first commit.** It never holds personal data: no vault content, no names of private people, no machine addresses, no employer names, no tokens, no absolute home paths. Tests use a neutral demo vault.
- **Leak checks run on every pull request and before each push:** `gitleaks` (the `secrets` CI job), and `bun run public-content` (`scripts/check-public-content.ts`), which fails on an absolute home path and on any string from a private denylist kept outside the repository.
- **Nothing personal is hardcoded in the engine.** Each person's details live in their vault (`.eva/assistant.md`) and their instance home.
- **Issues that Eva files at runtime** go to the person's private repository, never to `guplem/eva`.
- **No merge ruleset for now** (owner decision, 2026-10-14). CI runs on every pull request, and an agent never merges on red CI.

**Rejected alternatives:**

- **One repository, as in v1.** Autosave and code review fight over `main`, and a vault sync hook inside a code clone pushed the wrong repository (lesson 19).
- **A private engine.** Sharing needs an engine that anybody can read, and that holds no personal data.

## Consequences

**Positive:**

- The engine gets pull requests, CI, and the development standard; the vault keeps its fast autosave.
- A second person runs the same engine with their own vault.

**Trade-offs and follow-up:**

- Every agent that writes in this repository must treat each file, commit, issue, and PR as public.
- CI has no copy of the private denylist, so only the local pre-push run (Lefthook) checks it.
- The public-content check reads tracked files only; a new file is checked after `git add`.
- Development issues about the engine live in `guplem/eva` and must carry no personal content.
