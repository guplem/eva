# TypeScript for the core and the UI, run with Bun

## Context

Wall-I v1 was a Python server. Eva adds a web UI, connects to engines through their own libraries, and must be easy to install on Windows and Linux. The owner's view: the language does not matter; easy installation matters.

Source: lesson 50.

## Decision

- **TypeScript everywhere:** the core, the engine adapters, the front ends, the web UI, and the development scripts.
- **Bun runs it.** Bun runs `.ts` files with no build step (`bun run src/main.ts`), runs the tests (`bun test`), and installs the dependencies (`bun.lock`). CI pins the Bun version.
- **Strict compiler settings:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature` (`tsconfig.json`). No `any`.
- **Lint and format:** ESLint with `typescript-eslint` `strictTypeChecked` (it catches floating promises, lesson 50), and Prettier.
- **Distribution:** from source (`bun install`, `bun run eva`), or one executable per platform from `bun build --compile` (`bun run build:executable`). The executable uses the person's installed `claude`.

**Rejected alternatives:**

- **Python, as in v1.** The web UI would need a second language. The Claude Agent SDK, pi, and ACP ship TypeScript libraries.
- **Node.js.** No detailed comparison was made. Bun won because one tool gives the runtime, the test runner, the package manager, and the single-executable build.

## Consequences

**Positive:**

- One language and one toolchain from the core to the browser.
- The Agent SDK runs under Bun on Windows with the native `claude` (spike S2, a real run on 2026-10-14).

**Trade-offs and follow-up:**

- `typescript-eslint` 8.x supports TypeScript below 6.1 only. Keep `typescript` on 6.x until it supports 7.
- Bun's coverage reports lines and functions, not branches.
- The single executable behaves differently from a source run in a few places (see the `AGENTS.md` Gotchas). CI builds and starts it on Windows and Linux in each PR (`scripts/smoke-executable.sh`).
