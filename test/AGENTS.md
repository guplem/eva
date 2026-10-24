# Tests

- Fake only at the seams: the clock and sleep, the process runner, the long-process starter, the engine port and the fakes in `test/support/`. Use local bare remotes for git. Never mock our own modules.
- Put unit tests under `test/unit/`, at the same path as the `src/` file.
- Use a temporary folder, never the real home. Write no absolute home path in a fixture.
- For git, use `createGitSandbox` (it clears `GIT_*`). In a git environment that you build by hand, set `GIT_CONFIG_NOSYSTEM: "1"`: the Windows system config runs the credential manager, which opens a sign-in window. Pass `gitHookTimeoutMs` to a git step in a `beforeEach` or `afterEach` hook: hooks get 5 seconds.
- Pass `--timeout 30000` to a bare `bun test <file>`: without it, each test gets 5 seconds.
- The test scripts run the files in parallel worker processes. Keep each test file independent of the others. Listen on port 0. Write only in the file's own temporary folder.
- Turn the vault sync off in a test that runs Assistant turns but does not check the sync: each turn runs git, which is slow on Windows.
- Coverage is per file (90% lines, 80% functions). Set fields in the constructor, not in initializers. An `AbortSignal.timeout` that never runs zeroes the file: use a base-URL seam, as `src/core/checks.ts` does.
- To run `bun run test:e2e` in two checkouts at once, set `EVA_E2E_PORT=auto` and `EVA_E2E_GALLERY_PORT=auto` in each.
