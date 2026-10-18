# Tests

- Fake only at the named seams: clock and sleep, CLI host (`test/support/fake-host.ts`), process runner, long-process starter, git (local bare remotes), engine port, fake Telegram Bot API, fake MCP. Never mock our own modules.
- Unit tests live under `test/unit/` and mirror the `src/` path.
- Use a temporary folder, never the real home. Write no absolute home path in a fixture.
- For git, use `createGitSandbox` (it clears `GIT_*`). A git step in a `beforeEach` or `afterEach` hook passes `gitHookTimeoutMs`: hooks get 5 s.
- A bare `bun test <file>` gives 5 s per test: pass `--timeout 30000`.
- Coverage is per file (90% lines, 80% functions). Set fields in the constructor, not in initializers. An `AbortSignal.timeout` that never runs zeroes the file: use a base-URL seam, as `src/core/checks.ts` does.
