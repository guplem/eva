# Four source layers with import rules enforced in CI

## Context

AI agents write most of the engine (plan §13), and an agent takes the shortest import path unless a check stops it. Eva must support more engines later (intent goal 6), so the core and the front ends must not depend on one engine. v1 had the same rule: a front end never names an engine (v1 ADR `0003`).

Source: plan §4.2, §13; `.dependency-cruiser.cjs`.

## Decision

`src/` has four layers plus the wiring file:

| Layer            | Holds                                                                      | May import                          |
| ---------------- | -------------------------------------------------------------------------- | ----------------------------------- |
| `src/shared/`    | Types, errors, the event union, the seams (clock, process runner, logger)  | Nothing of ours                     |
| `src/core/`      | Instance, vault sync, projects, sessions, skill runs, approvals, schedules | `shared`                            |
| `src/engines/*/` | One adapter per engine; each implements the engine port                    | `shared` only; never another engine |
| `src/frontends/` | `api/`, `cli/`, `telegram/`, `web/`                                        | `shared` and the core's public API  |
| `src/main.ts`    | Wiring only                                                                | Everything                          |

`bun run arch` runs dependency-cruiser with `.dependency-cruiser.cjs`, inside `bun run check` and CI. Its rules: `shared-imports-nothing-of-ours`, `core-imports-only-shared`, `engines-import-only-shared`, `engines-stay-apart`, `frontends-never-import-engines`, `only-main-wires`, and `no-circular`.

The engine port and the event union (plan §4.6) live in `src/shared/`, so the core and each adapter depend on the same contract and never on each other.

**Rejected alternative:** a review rule with no check. An agent reads the rule once and forgets it; a failing CI check stops the PR every time.

## Consequences

**Positive:**

- A new engine is one new folder under `src/engines/`, with no change to a front end.
- Tests fake an engine at the port, which is one of the named seams (ADR 0009).

**Trade-offs and follow-up:**

- The core reaches an engine only through the port that `main.ts` passes in. Code that needs an engine detail must add it to the port or to an event, not import the adapter.
- dependency-cruiser checks `src/` only. `test/` and `scripts/` may import any layer.
