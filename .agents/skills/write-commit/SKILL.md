---
name: write-commit
description: Shape git commits well - atomic one-concern commits, conventional-commit subjects, why-focused bodies, and a branch history that reads as a clear story. Use when composing commits.
---

# Commit shape and message

- **One concern per commit.** Split unrelated changes, even when you made them in one session. A refactor, a doc update and a new test are three commits.
- **Group by intent, not by file.** A title such as "various fixes" means that several concerns got mixed. Name each commit after the one thing it does.
- **Subject plus body.** The subject says what changed, in 72 characters at most, with a conventional-commit prefix (`feat:`, `fix:`, `perf:`, `refactor:`, `build:`, `docs:`, `test:`, `chore:`, `ci:`, `style:`). A scope is optional, such as `feat(web):`. The body says why: the constraint, the old behavior, the failure it prevents, the issue. Only a trivial commit skips the body.
- **The prefix picks the release version.** `feat:` raises the middle number. `fix:`, `perf:`, `refactor:` and `build:` raise the last number. The other prefixes release nothing. Pick the prefix for the change to the executable, not for the size of the diff.
- **Mark a breaking change with `!`,** such as `feat!:`, or with a `BREAKING CHANGE:` line in the body. `AGENTS.md` defines a breaking change. In Eva, these changes are breaking:
  - A change to stored data that Eva cannot read anymore, such as a setting key, in the machine files or the vault files, unless a migration in `src/core/migrations/` converts the data.
  - The vault layout of `AGENTS.md`.
  - What the person types: a CLI command or flag, or a Telegram command.
  - The update path: the release asset names, the `SHA256SUMS` format or the release key.
- **History reads as a story.** `git log --oneline main..HEAD` follows the work in order: a refactor comes before the feature that needs it, and tests and docs come with the code that they cover.
- **Check before each commit.** Summarize the diff in one sentence. If the sentence needs an "and", split the commit.
- **Never** use `--amend`, `--no-verify` or a force-push. When a hook fails, fix the problem and make a new commit.
