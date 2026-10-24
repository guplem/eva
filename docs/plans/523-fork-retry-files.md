# Plan: choose the clone and the files for a fork or a retry (#523)

## Why

A person who retries a bad answer wants the files as they were before that answer. A person who forks to try another way wants the parent to keep its own files. Today a fork and a retry only branch the conversation: the files stay as the last turn left them.

## The owner's decisions (from the issue)

- A retry offers: undo and retry here (default), retry here with the files as they are, retry in a new clone with the files before that answer.
- A fork offers: a new clone with the files at that message (default), a new clean clone, the same clone.
- A fork or retry in the same clone shows as a branch of its chat. One in another clone shows in that clone, with a note that names its parent chat and clone.
- Assistant chats do not change. Telegram is out of scope.

The issue lists eight assumptions that an agent wrote. The owner did not object to them, and nobody answered the question about them in this session, so this plan follows them.

## Design

### 1. Snapshots (`src/core/projects/clone-snapshots.ts`)

- A snapshot is one git commit for each repository of a clone, under the ref `refs/eva/snapshots/<id>`. All repositories of one snapshot use the same id.
- Eva builds it with a copy of the index (`GIT_INDEX_FILE`), `git add -A`, `git write-tree` and `git commit-tree`, with the current `HEAD` as its parent. The real index, `HEAD` and the files do not change.
- The commit holds tracked and untracked files, and changes that a command made. `.gitignore` keeps ignored files out.
- The commit message records the branch: `Eva-Branch: <name>`, or no line for a detached `HEAD`. A repository with no commit gets a commit with no parent.
- A restore runs `checkout -f -B <branch> <parent>` (or `--detach`), `clean -fd` (not `-x`, so ignored files stay), and `restore --source=<snapshot> --worktree -- .`. A staged file comes back unstaged. A test in a scratch repository proved the steps.
- Before a restore in the same clone, Eva takes one more snapshot, so changes that a person made by hand after the last turn are not lost for good.
- Every git command runs with no hooks (`core.hooksPath` to a missing folder), as `clone-sync.ts` does, and a fixed identity, because the commit never leaves the computer.
- A repository that lacks the snapshot ref, such as one that the project gained later, stays as it is.

### 2. When Eva takes snapshots

- `TurnPreparer` gets two optional steps: `snapshot(session)` and `restore(session, id)`. Only `ProjectPreparer` has them.
- `SessionManager.runTurn` calls `snapshot` after `takeFolder`, before the engine starts, and again after the engine ends, before `releaseFolder`. So no other turn of the clone runs between the two.
- A failed snapshot gives `null`. The turn goes on, and the log says why.
- The turn record gets `startSnapshot` and `endSnapshot` (string or null). An old record reads them as null. This is tolerant reading, so there is no migration.

### 3. Retry

- `retry(sessionId, turnIndex, files)`, with `files` one of `undo`, `keep`, `new-clone`. Without `files`, the retry keeps the files, as before.
- `undo`: the new branch gets `pendingRestore` set to the start snapshot of the turn. Its first turn restores the files while it holds the clone folder, so no other turn runs during the restore (assumption 3). After a good restore, the field becomes null.
- `new-clone`: a new clone, with the files of the start snapshot. The new chat is the root of that clone's chat tree.
- A choice that needs a snapshot fails with the new error code `snapshot_missing` when the turn has none, such as an old turn.

### 4. Fork

- `fork(sessionId, atMessageId, files)`, with `files` one of `snapshot-clone`, `clean-clone`, `same-clone`. Without `files`, the fork stays in the same clone, as before.
- `snapshot-clone`: a new clone with the files of the end snapshot of the turn whose answer the fork starts at.
- `clean-clone`: the usual clone choice (a free clone that Eva resets, or a new clone, #521).
- `same-clone`: as today. The folder lock makes the turns wait in line.

### 5. A chat in another clone

- The chat has `parentId: null`, so it is the root of its clone's tree, and closing or deleting the parent leaves it (assumption 5).
- A new session field `forkedFrom: { sessionId, clone } | null` names the parent. An old record reads it as null.
- Its history comes from `forkFromEngineSessionId` and `forkAtMessageId`, as for any fork.
- `setEngine` refuses a chat that has `forkFromEngineSessionId`, not only one with a parent.

### 6. The history in another folder

- `EnginePort` gets an optional `carryHistory({ engineSessionId, toFolder, environment })` that returns true or false. An engine without it needs nothing (pi keeps its sessions in one folder).
- Claude Code: Eva finds `<CLAUDE_CONFIG_DIR>/projects/*/<id>.jsonl` and copies it to `<CLAUDE_CONFIG_DIR>/projects/<encoded folder>/`. The encoding replaces each character that is not a letter or a digit with `-`. A contract test pins it. Claude Code shortens a folder name longer than 200 characters with a hash, so Eva gives false for one.
- When the copy fails, the new chat continues from a summary (#522): it has `continuedFrom` set to the parent and the summary as its first message draft. A retry adds the retried message to the draft and sends nothing. The answer of the request carries a notice, and the web page shows it.

### 7. Clean-up of snapshot refs (assumption 7)

- When Eva reuses a clone, she deletes every `refs/eva/snapshots/*` ref of its repositories.
- When a chat is deleted, Eva deletes the refs of its turns, in the background.
- A deleted clone takes its refs with its folder.

### 8. API and web

- `POST /api/sessions/<id>/fork` takes `{ atMessageId, files? }`, and `POST /api/sessions/<id>/retry` takes `{ turnIndex, files? }`. Both answer `{ session, notice }`. The web page ships in the same release.
- In a Project chat, Retry and Fork open a dialog with the three choices. A choice that needs a missing snapshot is off, with a reason.
- A chat with `forkedFrom` shows a note: "Forked from <chat> in <clone>", with a link to the parent chat.

## Stored and sent names (new)

- Session fields `pendingRestore` and `forkedFrom`; turn fields `startSnapshot` and `endSnapshot`. All read old records tolerantly.
- Error code `snapshot_missing`.
- The fork and retry answers change their shape. The web page is the only caller.

None of these is a breaking change: the person does nothing by hand and loses nothing.

## Tests

- Snapshot and restore against a real git repository in a sandbox (`test/support/git-sandbox.ts`): tracked, deleted, untracked, ignored, branch change, later commits, a repository with no commit.
- The session manager: snapshots in each turn, a restore before the first turn of an undo retry, the turn waits for the folder.
- Project work: a fork or retry to a new clone, with and without a snapshot, and the summary fallback.
- Claude Code: the contract test of the history path and the copy.
- The web: the dialog choices, and the note of a moved chat.
