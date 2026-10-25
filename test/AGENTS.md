# Tests

- Fake only at the seams: the clock and sleep, the process runner, the long-process starter, the engine port and the fakes in `test/support/`. Use local bare remotes for git. Never mock our own modules.
- Put unit tests under `test/unit/`, at the same path as the `src/` file.
- Use a temporary folder, never the real home. Write no absolute home path in a fixture.
- For git, use `createGitSandbox` (it clears `GIT_*`). In a git environment that you build by hand, set `GIT_CONFIG_NOSYSTEM: "1"`: the Windows system config runs the credential manager, which opens a sign-in window. When a `beforeEach` or `afterEach` function runs git, pass `gitHookTimeoutMs` as its timeout: Bun gives these functions 5 seconds.
- When you run `bun test <file>` directly, pass `--timeout 30000`: without it, each test gets 5 seconds.
- The test scripts run the files in parallel worker processes. Keep each test file independent of the others. Listen on port 0. Write only in the file's own temporary folder.
- Turn the vault sync off in a test that runs Assistant turns but does not check the sync: each turn runs git, which is slow on Windows.
- Coverage is per file (90% lines, 80% functions). Set class fields in the constructor, not in field initializers. When no test runs a call to `AbortSignal.timeout`, the coverage of its whole file can drop to 0%. Add a base-URL seam, as `src/core/checks.ts` does, so a test runs the call against a fake server.
- To run `bun run test:e2e` in two checkouts at once, set `EVA_E2E_PORT=auto` and `EVA_E2E_GALLERY_PORT=auto` in each.
- The e2e tests share one demo server, and each chat title shows as a button in the list. `getByRole` matches part of a name, with any case. So a message such as "send the file" makes a later `{ name: "Send" }` find two buttons. Give a new demo message words that no button name holds.
