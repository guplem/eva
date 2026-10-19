# Tests

- Fake only at the seams: the clock and sleep, the process runner, the long-process starter, the engine port and the fakes in `test/support/`. Use local bare remotes for git. Never mock our own modules.
- Put unit tests under `test/unit/`, at the same path as the `src/` file.
- Use a temporary folder, never the real home. Write no absolute home path in a fixture.
- For git, use `createGitSandbox` (it clears `GIT_*`). Pass `gitHookTimeoutMs` to a git step in a `beforeEach` or `afterEach` hook: hooks get 5 seconds.
- Pass `--timeout 30000` to a bare `bun test <file>`: without it, each test gets 5 seconds.
- The test scripts run the files in parallel worker processes. Keep each file apart: listen on port 0, write only in its own temporary folder.
- Turn the vault sync off in a test that runs Assistant turns but does not check the sync. Each turn otherwise starts git many times, and git is slow on Windows.
- Coverage is per file (90% lines, 80% functions). Set fields in the constructor, not in initializers. An `AbortSignal.timeout` that never runs zeroes the file: use a base-URL seam, as `src/core/checks.ts` does.
