# Plan: pin a clone's trust to the remote that Eva cloned it from

Issue: #15. This file is a working plan. The last commit of the PR deletes it.

## Problem

`ProjectPreparer` reads the clone's live `origin` URL before each turn.
Code that runs in an untrusted clone can change that URL to a trusted owner's repository.
The next turn then runs as trusted, with the clone's hooks, settings and MCP servers on.

## Goal

- A clone that Eva created keeps the trust decision of the URL that Eva cloned from.
- A clone that Eva did not create gets the trust question, as an unknown repository does today.

## Steps

1. Add a `CloneOrigins` store in `src/core/projects/clones.ts`.
   It maps a clone folder to the URL that Eva cloned it from.
   It writes atomically and reads tolerantly (`src/shared/files.ts`), like `TrustStore`.
2. Add `cloneOrigins` to `HomePaths` (`state/clone-origins.json`).
3. Make `createClone` record the URL after a clone succeeds.
4. Change `ProjectPreparer` to use the recorded URL, not the live `origin`.
5. Handle a clone with no recorded URL (see gap 2).
6. Wire the store in `src/core/eva.ts`.
7. Update `docs/guide/reference.md` if it describes trust.
8. Delete this plan file.

Each step is red-green: a failing test first.

## Gaps

### Gap 1: where to keep the recorded URL

Options: a state file in Eva's home, a git config value in the clone, or the project front matter.
The clone and the vault are both writable by the agent, so the record must live outside both.

### Gap 2: a clone with no recorded URL

This covers a clone that Eva made before this change, and a folder made by hand.
Questions: ask on each turn or once? Does the trust store or the owner allowlist apply? Which URL does the question show?

### Gap 3: the key and stale records

Questions: how to normalize the clone path, and what happens when a person deletes a clone and makes a new folder at the same path.

## Decisions

To be filled after the gap research.
