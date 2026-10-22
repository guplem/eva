# Plan: git fails with no message in an Eva that Windows starts at logon (#430)

## Cause (reproduced)

- Windows gives a process that starts at logon the variable `Path`, not `PATH`. That `Path` has `Git\cmd`, but not `Git\usr\bin`.
- Bun's `process.env` is case-insensitive on Windows. So `buildChildEnvironment` reads both `PATH` and `Path` from the allowlist, and the child gets two keys with the same value.
- With the two keys, git cannot find `sh.exe` to run Eva's credential helper (`!f() { ... }`). git ends with exit code 128 and writes nothing.
- A terminal (such as Git Bash) has `Git\usr\bin` on its path, so git finds `sh.exe` there and the bug stays hidden.
- The restart after an update is not the cause: an Eva that the logon start runs fails too, before any update.
- Proof: the same `git fetch` and `git ls-remote` with the logon environment end with 128 and no stderr. With only one of the two keys, or with `Git\usr\bin` on the path, both work.

## Changes

1. `buildChildEnvironment`: on Windows, keep one key for each name, case-insensitive. A later value (the `extra` part) replaces an earlier one with the same name in another case. Linux stays case-sensitive.
2. A shared reason for a failed command: the error output, or else the exit code and the normal output. Never empty.
3. Use that reason in every failed git command of the vault code (`vault-clone.ts`, `vault-sync.ts`, `vault-template.ts`), and of the project clones (`clones.ts`, `clone-sync.ts`).
4. The vault sync's "Could not reach the remote." also gives git's reason.

## Gaps and decisions

- **Where the reason helper lives:** `src/shared/process-runner.ts`, next to `ProcessResult`, so core and frontends can use it.
- **Case rule on Linux:** no change. `PATH` and `Path` are two variables there.
- **Docs:** the person sees a reason now, but no flow changes. No guide change.
- **Owner action:** none. The next update brings the fix, and the supervisor's next restart runs it.
