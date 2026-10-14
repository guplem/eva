# Naming

A name says what the thing is or does, so a reader understands it without the code around it. Generic names (`data`, `info`, `handler`, `utils`, `helpers`, `manager`) are not allowed.

## Product name

- **Write `Eva` in prose and `eva` in identifiers** (plan, header). Examples: `EvaError`, `eva.lock`, `EVA_HOME`, `eva-test@example.invalid`.

## Code

| Thing                                        | Form                                          | Examples                                            |
| -------------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| File and folder                              | kebab-case                                    | `project-id.ts`, `instance-lock.ts`, `claude-code/` |
| Type, interface, class                       | PascalCase                                    | `ParsedProjectId`, `ProcessRunner`, `EvaError`      |
| Function, method, variable                   | camelCase                                     | `parseProjectId`, `buildChildEnvironment`           |
| Module constant                              | camelCase, not UPPER_CASE                     | `baseEnvironmentAllowlist`, `gracePeriodMs`         |
| Code string (error code, event kind, status) | snake_case string literal                     | `config_invalid`, `turn_finished`, `tool_started`   |
| Environment variable                         | UPPER_SNAKE_CASE, `EVA_` prefix for Eva's own | `EVA_HOME`, `EVA_PRIVATE_DENYLIST`                  |
| Production value of a seam                   | `system` + the seam name                      | `systemClock`, `systemProcessRunner`                |

- **Put the unit in a name that holds a quantity:** `timeoutMs`, `gracePeriodMs`, `sizeBytes`.
- **Name a boolean as a question:** `isError`, `isProcessAlive`, `hasCommits`.
- **Name a function with a verb:** `parseProjectId`, `formatProjectId`, `acquireInstanceLock`. A function that can return nothing says so in its type (`ParsedProjectId | null`), not in its name.
- **A name that would clash with a reserved word gets a trailing underscore:** `arguments_`.
- **Use the plan's words for the plan's concepts:** instance, home folder, vault, project, clone, session, fork, retry, turn, engine, front end, Assistant mode, Project mode. Never swap in a synonym (for example "workspace" for clone).

## Types

- **Write an explicit return type on every function** (ESLint `explicit-function-return-type` and `explicit-module-boundary-types`).
- **Write an explicit type on every parameter and every non-trivial variable.** No `any`; use `unknown` and narrow it.
- **Mark fields `readonly`** unless the code changes them.
- **Model a closed set as a union of string literals**, not as an `enum` (`ProjectIdPrecision`, `EvaErrorCode`).

## Tests

- **One `describe` per exported function or class,** named exactly after it: `describe("parseProjectId", ...)`.
- **A `test` name states the behaviour in plain words,** from the caller's view: `"rejects a folder that is not a project id"`.
