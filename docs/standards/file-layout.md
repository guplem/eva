# File layout

## Source layers

`src/` follows the layers of plan §4.2. `bun run arch` (dependency-cruiser, `.dependency-cruiser.cjs`) fails on an import that breaks them. ADR 0005 records why.

```
src/
  shared/        types, errors, the event union, seams (clock, process runner, logger)
  core/          instance, vault sync, projects, sessions, skill runs, approvals, schedules
  engines/       claude-code/, pi/   (adapters; implement the engine port)
  frontends/     api/ (HTTP + WebSocket), cli/, telegram/, web/
  main.ts        wiring only
```

| Layer            | May import                                |
| ---------------- | ----------------------------------------- |
| `src/shared/`    | Nothing of ours                           |
| `src/core/`      | `src/shared/`                             |
| `src/engines/*/` | `src/shared/` only; never another engine  |
| `src/frontends/` | `src/shared/` and the core's public API   |
| `src/main.ts`    | Everything; nothing imports `src/main.ts` |

## Where a new file goes

- **A seam** (an interface to the outside world: clock, process runner, git, logger) and its `system*` production value go in `src/shared/`.
- **A type or a contract that two layers share** (the event union, the engine port, error codes) goes in `src/shared/`.
- **A decision** goes in `src/core/<area>/`. The areas that exist are `instance/`, `projects/`, and `vault/`. Name a new area after its row in plan §4.1, in kebab-case (for example `sessions/`).
- **Engine-specific code** goes in `src/engines/<engine>/`, and nowhere else.
- **A front end** goes in `src/frontends/<front-end>/`. It never names an engine.
- **Wiring** (create the production seams, pass them into the core, start the front ends) goes in `src/main.ts` only. Keep decisions out of it: it has no unit test.
- **A development script** (not shipped in Eva) goes in `scripts/`. Scripts sit outside the layers, the coverage, and the mutation run.

## Files

- **One module per file,** named after what it holds (`project-id.ts`, `instance-lock.ts`).
- **Import with a relative path and the `.ts` extension** (`./errors.ts`, `../../shared/clock.ts`).
- **Use `import type` for an import that is only a type.** ESLint (`consistent-type-imports`) enforces it.
- **Start each file with a short comment** that says what the module is for and cites the plan section or lesson when one applies.

## Tests

`bun test` finds tests only under `test/` (`root` in `bunfig.toml`).

```
test/
  unit/<layer>/<same path as in src>/<module>.test.ts
  contract/<engine>/<module>.test.ts       (planned, P3: adapter argument and parser contracts)
  e2e/<flow>.test.ts                       (planned, P3: the core with fakes)
  fixtures/<engine>/<case>.*               (planned, P3: output captured from the neutral demo vault)
  support/<helper>.ts                      shared fakes and sandboxes
```

- **Mirror the source path.** `src/core/projects/project-id.ts` has its test at `test/unit/core/projects/project-id.test.ts`.
- **Put a fake or a sandbox that two test files use in `test/support/`** (for example `createGitSandbox` in `test/support/git-sandbox.ts`). A fake used by one file stays in that file.
- **Never put a test file in `src/`.** It never runs, and Stryker and coverage treat it as source.
- The web UI tests (Playwright, P5) get their own folder when they land; record it here.
