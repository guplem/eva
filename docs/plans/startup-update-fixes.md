# Plan: startup, instance lock and update fixes (#509)

Fix five small bugs. Each fix starts with a failing test.

## Fixes

1. `startup.ts`: claim the hub only when the pull status is `ok`, or when the vault has no `origin` remote. Otherwise add a warn note and claim at a later start.
2. `instance-lock.ts`: treat a lock as stale when its file is older than this boot. The boot time is `Date.now() - os.uptime() * 1000`.
3. `source-update.ts`: say "has its own commits" only when the checkout is ahead of the remote. Otherwise give git's own reason.
4. `self-update.ts`: guard `response.json()` and check that the reply is a list of releases.
5. `vault-files.ts`: move `statSync` into the try, and skip a file that went away.

## Gaps and decisions

- **How does startup know that the vault has no remote?** A pull with no remote fails its fetch and reports `offline`. Decision: run `git remote get-url origin` through the runner, as `clones.ts` does, only when the pull status is not `ok`. A folder that is not a git repository has no remote either, so a plain folder vault still claims the hub.
- **What does a machine do when it skips the claim?** `machineRole` already treats a vault with no `hub.json` as "hub", so this run works as before. Only the file is not written. The next start claims after a good pull.
- **Where does the boot time come from, without a change to the callers in `src/frontends/cli/`?** Decision: add an optional `bootTimeMs` to `LockProbe`. When a caller gives none, the lock reads `os.uptime()`. Tests pass a fixed value.
- **When does the mtime check apply?** A wall clock that jumps forward after Eva wrote the lock could make a running Eva look stale. Decision: use the mtime check only when the boot id is missing on either side (Windows, macOS). Allow 2 minutes of clock change.
- **What is a bad release list?** A reply that is not JSON, or not an array. An entry that is not an object with a string `tag_name` is skipped.
