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

Three agents researched each gap. They agreed on each point below.

### Gap 1: a state file in Eva's home

- Keep the record in `state/clone-origins.json`, next to `state/trust.json`.
- The clone's `.git/config` holds the live `origin`, so code in the clone can edit it. The vault is open to the agent too (`src/core/settings/AGENTS.md`).
- A `CloneOriginStore` class in `src/core/projects/clones.ts` mirrors `TrustStore`.
- Keep it apart from `trust.json`: that file holds answers by URL, this one holds facts by clone.
- `createClone` takes the store and records the URL after a clone succeeds.

### Gap 2: ask once, then pin the folder

- A clone with no record gets the question. The stored URL answers and the owner allowlist do not apply, because its live URL is only a claim.
- The question names the clone and says that Eva did not clone it.
- An answer pins the folder: the store keeps the URL shown and the answer. Later turns use that answer and never read `origin` again.
- The answer stays with the folder, not in `trust.json`. The person judged one folder, not every clone of that URL.
- An expired question pins nothing, as today.
- Clones made by Eva before this change get the same question once. Eva cannot tell them from a folder made by hand.

### Gap 3: the key and stale records

- `startFolder` and `clone.path` are the same string today. A small `cloneKey` helper still applies `resolve()`, and lowercases on Windows, so a vault path with another case still matches.
- No `realpath`: it fails on a missing folder.
- A new clone overwrites the record of its folder. `cloneFolderName` only picks a folder that does not exist.
- No folder fingerprint. One agent proposed it against a folder deleted and made again at the same path. That attack needs write access to a sibling clone, and that access can already plant hooks in the sibling. So the fingerprint adds code and a Windows risk for no real gain.
- A missing record fails safe: Eva asks.
