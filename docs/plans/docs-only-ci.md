# Plan: skip the code-only CI work on a docs-only PR (#103)

This is the working plan for #103. The last commit of the PR deletes it.

## Goal

A PR that changes only docs skips the work of `web-ui`, `voice`, `package` and the Windows `checks` job. Each of these checks still reports success, so the merge ruleset needs no change. `checks` (Ubuntu) and `secrets` always run in full. A push to `main` and a PR with any other path run every job in full.

## Steps

1. Write a failing test for a function that takes a list of changed paths. It says that code changed unless every path is a docs path.
2. Write the function and a small script around it. The script reads the changed paths and writes `code_changed=true|false` to the step output.
3. Add a first job, `changes`, that runs the script on a PR. On a push, or when the diff fails, it says `code_changed=true`.
4. Make `web-ui`, `voice`, `package` and `checks` depend on `changes`. Put an `if:` on each step of the code-only work, not on the job.
5. Add a workflow comment that says why the steps skip and the jobs do not.

## Gap decisions

Three agents reviewed the gaps. They agreed on each answer.

1. **Where the rule lives.** A Bun script, `scripts/ci-changes.ts`, exports the pure rule and guards its I/O with `import.meta.main`. The test is `test/unit/ci-changes.test.ts`, like `agent-settings.test.ts`: a script has no `src/` twin. The script uses no package, so the job needs no `bun install`.
2. **The changed files.** A `pull_request` run checks out the merge commit. Check out with `fetch-depth: 2` and run `git diff --name-only --no-renames -z HEAD^1 HEAD`. `--no-renames` lists both paths of a rename, so a move from `src/` to `docs/` counts as code. `-z` keeps odd file names unquoted.
3. **A failed `changes` job.** A failed `needs` job skips its dependents, and a skipped job satisfies a required check. A code PR could then merge untested. So the script fails open: an error, an empty diff or a push gives `code_changed=true`. Each dependent job gets `if: ${{ !cancelled() }}`, and each step tests `code_changed != 'false'`. An empty output then means "run".
4. **The ruleset.** No change. `changes` is not a required check, and the other job names stay the same.
5. **The `checks` matrix.** A job-level env, `RUN_CODE_CHECKS`, is true on Ubuntu or when code changed. Each step tests it.

## Extra decisions

- **Runtime Markdown.** `src/core/modes/assistant-base-prompt.md` ships inside the executable. So a `.md` file under `src/` or `test/` is code, unless its name is `AGENTS.md` or `CLAUDE.md`. Each file under `templates/` is code: the whole vault template ships. A file that does not end in `.md` is always code.
- **The whisper cache.** When the cache step skips, its `cache-hit` output is empty. The build step must test `code_changed` too, or it runs.

## Review round 1

Five agents reviewed the work. Fixed:

- The dead `templates/` entry in `codeFolders`, and a comment that called every agent file docs.
- The ruleset fact said twice in the workflow, and a comment that gave the wrong reason for skipping steps.
- Test cases for `SECURITY.md`, a template skill and an upper-case `.MD`.

Not changed:

- **Job-level `if:` for `web-ui` and `voice`.** One form for every code-only job is easier to read. The issue also asks for step-level skips.
- **Fail open in both the script and the workflow.** The script keeps the `changes` job green on a git error. The workflow covers a job that cannot start.
- **A retargeted pull request keeps its old result.** A base change needs the `edited` event, which also reruns all of CI on each title edit. The case needs a stacked pull request, and the owner reviews each retarget.
- **The pull request runs its own `ci-changes.ts`.** The Ubuntu checks and the owner's review still apply.
