# Plan: the vault upgrade handles what the first real upgrade missed (#809)

## Why

The first real v2 → v3 upgrade kept duplicate rules, linked a job's record instead of moving it, left knowledge and duplicates where they were, moved a mixed note whole, left `Scratch/` mentions, finished with a failed detection test, and refused two moved photos as secrets. The next person's upgrade must do it right, with no new question round and a short skill.

## Changes

1. **Code: one text-scan rule for binaries** (`src/shared/redaction.ts`): `bytesContainSecretPattern(bytes)` is false for content with a NUL byte, else `containsSecretPattern` of the text. The vault sync's `withheldReason` and `finish`'s `refuseUnsafeFiles` both use it.
2. **Code: `finish` skips a pure move.** `refuseUnsafeFiles` reads the blob hashes of the merge-base tree (`git ls-tree -r <merge-base>`) and skips the scan of a file whose blob is among them. The size limit and `isPlainSecret` still run on every file. It reads each blob as raw bytes (`git cat-file blob`).
3. **CHANGELOG v3** (amended, no v4): item 1 gets a job's or study's own record; a new item for knowledge and duplicates; item 9's `Scratch/` line repoints mentions; "What to ask" names duplicates and the "leave out" proposal.
4. **SKILL.md:** step 1.4/1.5 find duplicates and split mixed notes by section; step 1.6 sorts each own line, with "leave out" for a line that v3 already says or contradicts; step 2's first bullet names that proposal; "Lose nothing" names a merged note; step 4 repoints `Scratch/` mentions; step 5 runs each detection test on the branch and the summary names a failed one.

## Gaps and decisions

The owner is away; these are the choices he would make (simple, one place per fact, nothing lost, existing users safe).

- **Where the binary rule lives:** in `redaction.ts`, beside `containsSecretPattern`, so both callers share it. Decided.
- **What "already on main" means:** the tree of the merge base, at any path. A pure move or copy is no new risk. Decided (orchestrator guidance).
- **The sync and moves:** the sync gets only the binary rule; it scans files on disk with no merge base, and a hash per file would cost a process for each commit. Decided.
- **`isPlainSecret` for a binary:** it still runs on every file, with the raw bytes; it is a path check. Decided.
- **No v4:** no template file changes, so `shipped-texts.json` and `templates/vault/` stay. Decided.
- **A failed detection test:** reported with paths and a proposed fix in the final review; never blocks `finish`. Decided.
- **Duplicate threshold:** same title or same first paragraph; the person decides which to keep. Decided.
- **Skill size:** each fix is one line or a clause in an existing step. Decided.

## Tests (red first)

- `finish` merges a branch that moved a file already on main whose text matches a token pattern.
- `finish` merges a branch that adds a new binary file whose bytes match a token pattern.
- `finish` still refuses a plain binary at a secret-file path, and a new text file with a token (exists).
- The sync commits a binary file whose bytes match a token pattern, and still withholds a text file (exists).
- `bytesContainSecretPattern` unit cases.
