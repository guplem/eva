# Layered testing: unit tests at named seams, adapter contracts, end-to-end with fakes

## Context

The repo mandates red-green TDD. Eva talks to many outside systems: git, engines, the Telegram Bot API, MCP servers, the clock, and child processes. A real engine needs a login, and an agent often works without the owner. v1 learned that a fake at a second, unnamed path lets a bug escape (lesson 102), that only a real run catches a dropped flag (lesson 101), and that coverage above 90% caught none of the shipped bugs (lesson 103).

Source: plan §10, §13; lessons 31, 101 to 104; `bunfig.toml`, `stryker.config.json`.

## Decision

**Fake only at the named seams:** the clock, the process runner, git (local bare remotes), the engine (the engine port), the Telegram Bot API (a fake server), and MCP (a fake server). Everything inside a seam runs for real in a test.

| Layer of tests           | Covers                                                         | How                                                                                                          |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Unit                     | `src/shared/`, `src/core/`                                     | `bun test`, fakes at the seams, under `test/unit/<layer>/`                                                   |
| Adapter contract         | `src/engines/*/`                                               | Parser tests on output captured from a neutral demo vault; tests on the exact SDK options and argument lists |
| Front end                | CLI, local API, Telegram (P4)                                  | Against a fake engine; Telegram against a fake Bot API server                                                |
| Web UI (P5)              | The three mockup screens, `Host`, `Origin`, identity rejection | Playwright, at desktop width and 375 px                                                                      |
| End-to-end               | The core with sync, sessions, approvals                        | Local bare git remotes and a fake engine                                                                     |
| Live smoke (planned, P3) | The real engine                                                | `bun run smoke:live` with a real login, or a line in `docs/owner-todo.md`                                    |

**Floors:**

- **Coverage:** 90% lines and functions (`bunfig.toml`). Bun reports no branch coverage.
- **Mutation testing:** Stryker on `src/core` and `src/engines`, break threshold 60, nightly in CI and on demand (`bun run mutation`).
- **Lessons:** each `[keep]` or `[adapt]` lesson that a phase touches has a test, or a comment in the code that says why no test is possible.

**Exempt:** `src/main.ts`. It only wires the layers, and the end-to-end and live runs exercise it.

**Rejected alternatives:**

- **A 100% coverage floor.** None of v1's shipped bugs would have been caught by more coverage (lesson 103).
- **Mocks of internal modules.** A second path to a seam escapes the tests (lesson 102), and a mock of our own code only proves that the code calls what the test told it to call.
- **Live engine runs in CI.** They need a personal login, which a public repository must never hold.

## Consequences

**Positive:**

- The suite runs without the owner, a login, or the network.
- A fixture is real engine output, so a parser test breaks when the engine changes its format.

**Trade-offs and follow-up:**

- A fixture must come from the neutral demo vault, never from a real vault, because the repository is public.
- Captured fixtures go stale when an engine updates; the live smoke run is the check that finds it.
- The coverage floor is one floor for the whole run, not one per layer as plan §13 states. Split it if one layer hides behind another.
