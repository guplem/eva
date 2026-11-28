# Plan: Eva's own git ignores the program settings of a chat's folder (#1131)

## Why

Eva runs her own git outside the sandbox, with the GitHub token. A Project chat can write some git files of its folder. Eva's git must not start a program that such a file names.

## Where Eva runs git on a folder that a chat can write

- The repositories of a clone: `clone-snapshots.ts`, `clones.ts` (with `gh pr view`), `clone-sync.ts`.
- The vault, through a nested repository that a specialist or general chat makes in its project folder. After vault sync stages it as a gitlink, git starts a child git in it.

## Layers

1. **Layout gate.** Before each clone call, refuse a repository whose `.git` is not a plain folder, or that holds `commondir` or `config.worktree`, or whose `config` is not a regular file.
2. **Environment overrides.** `gitEnvironment` and `gitEnvironmentWithToken` set `GIT_CONFIG_COUNT` values that turn off the file-system monitor, the submodule recursion and the fixed program settings that are safe to force. The clone guard also forces an empty hooks folder.
3. **Check of the repository's own config.** Before a clone operation, `git config --list --show-scope` lists each setting. Refuse a repository when a `local` or `worktree` setting names a program or a redirect.

## Decisions (parent review)

- Refuse a worktree clone and a `commondir`, with a message.
- Allow only the exact values of `git lfs install --local` as local filters. Refuse every other local filter, with a message that names the key.
- Leave a local `core.hooksPath` alone: the clone guard forces its own.
- Use `GIT_CONFIG_COUNT`. The config check also refuses a local `core.fsmonitor` that is not a boolean, for old git. Warn about git older than 2.31.
- The vault gets the environment overrides. Its hooks stay.
- Sandbox denies go to a follow-up issue.
- The refusal reaches the chat as a notice, the project view row and the sync screen. It names the repository folder only.
