# Plan: the file wall of each Project chat (#711)

The issue holds the decisions and the assumptions. This plan maps them to the code and lists the gaps.

## Work units

1. **The area of a chat:** a chat in a clone gets its clone folder. A specialist chat gets its project folder. An Assistant chat gets no area, and keeps the whole vault.
2. **The path check:** one pure function says whether a path is inside the area. It follows each link of the path that exists, compares with no case on Windows and macOS, and takes both separators. A new file is checked by its nearest folder that exists.
3. **Claude Code, the file tools:** Eva refuses Read, Write, Edit, MultiEdit, NotebookEdit, Glob and Grep outside the area, in every permission mode. A call inside the area keeps the behavior of its permission mode.
4. **Claude Code, the shell:** the sandbox, through the SDK's `settings` option: `denyRead` and `denyWrite` on the vault and each extra project root, `allowRead` and `allowWrite` on the area, the home folder and the temporary folder for writes, the network open, `allowUnsandboxedCommands: false`, `autoAllowBashIfSandboxed: false`, `failIfUnavailable: false`.
5. **pi:** Eva's own pi extension refuses its file tools outside the area. pi has no shell wall.
6. **The status item:** where the shell wall cannot work, the Settings page and `eva status` say so, with the reason. A chat does not stop for it.
7. **Texts:** the goal in `AGENTS.md`, the guide, and the contract tests in `src/engines/`.

## Gaps

1. The exact `sandbox` settings for the SDK: does a narrower `allowWrite` inside a wider `denyWrite` win? Which setting keeps every host open? Does the `settings` option or the `sandbox` option carry `allowRead`?
2. Under `bypassPermissions`, which hook sees each file tool call: `ask` rules with `canUseTool`, or an SDK `PreToolUse` callback? Does `disableAllHooks` (a specialist chat, #703) turn off an SDK callback?
3. How Eva learns that the sandbox did not start, on each platform, so the status item can say why.
4. Glob and Grep: which arguments name a folder, and must Eva check the files that they return?
5. pi's file tools and their path arguments.
6. Where the turn options of a Project chat are built for each engine, and every registration point of a new status item.
