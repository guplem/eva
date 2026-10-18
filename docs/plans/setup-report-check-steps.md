# Plan: the setup report reads the CI steps and the git hooks

Issue #91.

## Why

The setup report shows "CI on pull requests" green when any workflow runs on pull requests. It shows "Git hooks" green when a hook config exists. Neither proves that a check runs. The owner asked for "CI checks (lint, tests, ...)" in #74.

## What changes

1. `repository-facts.ts` reads more facts:
   - Each workflow gets `commands`: the `run` text and the `uses` action of each step.
   - `scripts`: the `scripts` of the root `package.json`. An empty record when the file is absent. Null when GitHub does not serve it.
   - `hooks`: the commands that run before a commit and before a push. It reads Lefthook, Husky and pre-commit configs. Null when GitHub does not serve one of them.
2. A new pure module, `repository-checks.ts`, finds which checks a list of commands runs: format, lint, tests.
   - It follows a package script call, such as `bun run check` or `npm test`, into the script text. It stops at a cycle.
   - It reads the tool of each simple command. It skips runners such as `npx`, `bunx`, `go`, `cargo` and `python -m`.
   - The tool name decides the check. A name that contains `lint` is a lint. A name that contains `test` as a part is a test.
3. `repository-setup.ts` uses the result:
   - CI: green when the pull-request CI runs a lint and tests. Yellow when it misses one. Red when no workflow runs.
   - Git hooks: green when a hook runs a format check, a lint or tests. Yellow when the hooks run none. Red when no hook setup exists.

## Gaps and decisions

- **Stack-neutral:** the classifier knows the common tools of JavaScript, Python, Go, Rust, Ruby and PHP. An unknown tool counts as no check. Decision: a yellow item says what Eva found, so a false yellow is easy to judge.
- **Hooks without tests:** Eva's hooks run no tests, because CI runs them. Decision: any check in a hook is green, as the issue asks only "run checks".
- **CI without a format check:** the issue asks for a lint and a test step. Decision: the format check shows in the detail, but does not decide the light.
- **lint-staged:** its name contains `lint`, so it counts as a lint. Decision: Eva does not read its config. It almost always runs a linter or a formatter.
- **Stored names:** `RepositoryFacts` is not stored or sent. Only the `SetupReport` reaches the web app, and its shape does not change. No migration.
