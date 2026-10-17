# Tests

ADR 0009 records the testing strategy and why. This file holds the rules for each test that you write.

## Red-green

- **Write the failing test first** (red), run it, and see it fail for the right reason. Then write the smallest code that makes it pass (green). Then clean up.
- **A bug fix starts with a test that reproduces the bug.**
- **A commit that changes `src/` with no test change states the reason in its message.**
- **Each `[keep]` or `[adapt]` lesson in `docs/lessons-from-v1.md` that your change touches gets a test,** or a comment in the code that says why no test is possible. Name the lesson number in the test name or a comment.

## Seams and fakes

- **Fake only at the named seams** (lesson 102):

  | Seam             | Production                                             | In tests                                                                 |
  | ---------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
  | Clock            | `systemClock` (`src/shared/clock.ts`)                  | A fake `Clock` with a fixed or stepped time                              |
  | Process runner   | `systemProcessRunner` (`src/shared/process-runner.ts`) | A fake `ProcessRunner` that records the command and returns a set result |
  | Git              | The real `git` on a real remote                        | Local bare remotes (`createGitSandbox`, `test/support/git-sandbox.ts`)   |
  | Engine           | An adapter in `src/engines/`                           | A fake engine behind the engine port                                     |
  | Telegram Bot API | `api.telegram.org`                                     | A fake Bot API server                                                    |
  | MCP              | A pinned MCP server                                    | A fake MCP server                                                        |

- **Never mock an internal module.** Everything between two seams runs for real.
- **Pass the seam in.** Core code receives the seam as an argument or an option, so a test can pass the fake. Core code never calls `new Date()`, `Bun.spawn`, or `fetch` directly.
- **Never reach a second path to a seam** that the test does not fake. If code needs the time, it asks the `Clock`.

## Engine adapters

- **Test the parser on captured real output** (lesson 101). Store it as a fixture under `test/fixtures/<engine>/`.
- **Capture fixtures only from the neutral demo vault.** Never from a real vault: the repository is public. Check each fixture for names, paths, tokens, and machine details before you commit it.
- **Pin the exact SDK options and argument lists in a contract test** (lesson 101), per mode (ADR 0007). A dropped flag must fail a test.

## Isolation

- **Never touch the real home folder, vault, or config.** Create a temporary folder (`mkdtempSync(join(tmpdir(), "eva-..."))`) and remove it after the test.
- **Clear every `GIT_*` variable before a test runs git** (lesson 104). `createGitSandbox` does this; reuse it.
- **Set `GIT_TERMINAL_PROMPT=0`** for every git step in a test (lesson 100).
- **Use no network, no real login, and no real engine** in `bun test`. The live run is `bun run smoke:live`.
- **Write no absolute home path in a test or fixture.** The public-content check fails on one. Build paths from `tmpdir()` or use neutral paths.
- **Make every test pass on Windows and Linux.** Build paths with `node:path`, and compare paths after you normalize them.

## Shape

- **Assert the behaviour, not the calls.** A test that only checks that a function was called proves nothing.
- **One behaviour per `test`.** Use `describe` and `test` from `bun:test` (`docs/standards/naming.md` has the naming rules).
- **No sleeps to wait for a result.** Step the fake clock, or await the promise.

## Floors

- **Coverage:** `bun run test:coverage` fails under 90% lines or functions (`bunfig.toml`). Bun counts only files that a test imports, and reports no branch coverage.
- **Mutation:** `bun run mutation` (Stryker on `src/core` and `src/engines`) fails under a score of 60. CI runs it nightly. Run it on demand after you change core logic.
