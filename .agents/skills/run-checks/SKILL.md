---
name: run-checks
description: "Run the repo's checks and report pass or fail, exactly as CI runs them. Use just before creating a pull request or pushing, and any time you need to confirm the code still passes. It runs `bun run check`: the format check, lint, typecheck, architecture rules, dead code, the public-content check, and the tests with coverage. It never changes application code."
---

You are the validator for Eva. You run the repo's checks and report what passed and what failed. When your tool can run a separate agent for it (a subagent), hand this skill to one, so its reading stays out of your own context. You never change application code; fixing a failure is the caller's job.

## When to run

- After code changed, just before creating a pull request (PR) or pushing a branch.
- Any time the caller needs to know the code still passes.

You run the same checks that CI runs (CI is the set of automatic checks GitHub runs on every PR), in the same order. So when you report PASS, the `checks` job on the PR passes too. You are the local mirror of CI, linting included. CI also runs the `checks` job on Windows and a `secrets` job (gitleaks); you cannot run those here, so name them as "not run locally" in the report.

## Procedure

1. **Find what changed.** Run `git diff --name-only HEAD` and `git diff --name-only --cached`, or use the scope the caller gave you. List new untracked files with `git status --short`.
2. **Warn about untracked files.** The public-content check reads only tracked files (`git ls-files`). If a new file is untracked, say so in the report: the check did not read it.
3. **Run every check in order.** All commands run from the repository root. `bun run check` chains the steps below with `&&`, so it stops at the first failure. Run it first; if it fails, run each remaining step on its own so the report covers all of them.

   | Step           | Command                  | Run when                                                                 | Success looks like                                         |
   | -------------- | ------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
   | Install        | `bun install`            | Only when `package.json` or `bun.lock` changed, and the caller allows it | `bun install` exits 0                                      |
   | Format check   | `bun run format:check`   | Always. Fix drift with `bun run format`.                                 | "All matched files use Prettier code style!"               |
   | Lint           | `bun run lint`           | Always                                                                   | No output, exit 0                                          |
   | Typecheck      | `bun run typecheck`      | Always                                                                   | No output, exit 0                                          |
   | Architecture   | `bun run arch`           | Always                                                                   | "no dependency violations found"                           |
   | Dead code      | `bun run deadcode`       | Always                                                                   | No findings, exit 0                                        |
   | Public content | `bun run public-content` | Always                                                                   | "Public content check passed (N private strings checked)." |
   | Tests          | `bun run test:coverage`  | Always                                                                   | "0 fail", and no coverage threshold error                  |

4. **Do not stop at the first failure.** Run every check, then report all results together.
5. **Note the denylist count.** "0 private strings checked" means the private denylist is absent on this machine, so only the home path check ran. Report it.

Skip a step only when its "Run when" trigger clearly did not happen. When in doubt, run the full sequence: it is cheap and order-safe. Never run `bun run mutation` unless the caller asks: it is slow, and CI runs it nightly.

## Output format

```markdown
# Validation report

## Summary

- **Overall result:** PASS | FAIL
- **Format:** PASS | FAIL
- **Lint:** PASS | FAIL
- **Typecheck:** PASS | FAIL
- **Architecture:** PASS | FAIL
- **Dead code:** PASS | FAIL
- **Public content:** PASS | FAIL (N private strings checked; untracked files not read: <list or none>)
- **Tests:** PASS (N) | FAIL (N passed, N failed); coverage lines X%, functions Y%
- **Not run locally:** the Windows leg of `checks`, the `secrets` job (gitleaks)

## Failures (if any)

### [FAIL] <check name>

**Command:** `<command>` | **Working directory:** repository root | **Exit code:** N
**Error output:** <the relevant part, last ~50 lines>
**Likely cause:** <one sentence>
**Suggested fix:** <one actionable suggestion>
```

## Rules

- **Run each command from the repository root**, and state it next to the command.
- **Do not change application code.** You only run the checks and report; the caller fixes the code.
- **Do not install dependencies unless the caller tells you to.**
- **Be short on success, detailed on failure.**
- **A check that fails on code the change did not touch is pre-existing.** Report it as pre-existing; never "fix" unrelated code just to make the run pass.
- **Never print a denylist entry.** If the public-content check fails on a private string, report the file and line only, as the script does.
