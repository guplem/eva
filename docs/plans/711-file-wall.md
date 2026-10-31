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

## Decisions

The three gap agents answered from the installed SDK (0.3.300) and Eva's code.

- **The file tools:** an SDK `PreToolUse` hook callback refuses a call outside the area. A hook deny comes before the permission mode, so it holds under `bypassPermissions` too. `disableAllHooks` turns off the hooks of settings files and plugins only, so a specialist chat keeps the callback. A call inside the area gets no answer from the hook, and so keeps the behavior of its mode.
- **The tool fields:** Read, Write and Edit name `file_path`. NotebookEdit names `notebook_path`. Glob names `pattern` and an optional `path`; an absolute pattern replaces `path`. Grep names `path`, and also takes `file_path`. This SDK has no MultiEdit tool.
- **The path check** lives in `src/shared/path-area.ts`, so both engines and the core use it. It resolves a relative path against the start folder, follows each link of the part that exists, checks a new file by its nearest folder that exists, and folds case on Windows and macOS. A Glob pattern with `..`, or an absolute one outside the area, is refused.
- **The sandbox writes:** writes are deny by default, and a `denyWrite` inside an `allowWrite` wins. So Eva does not deny the vault for writes: that would close the area too. A sandboxed command writes only to its start folder, the temporary folder and a short list of tool caches in the home folder. The whole home folder stays closed for writes: the default vault lives in it.
- **The sandbox reads:** `denyRead` holds the vault and each extra project root, and `allowRead` holds the area.
- **The network:** no setting keeps every host open. A host that no rule names goes to `canUseTool` as `SandboxNetworkAccess` in the default mode. Eva answers it with an allow in a Project chat, so `git push` and package installs work as before. `bypassPermissions` allows it by itself. `auto` asks its classifier.
- **The switches:** `enabled: true`, `failIfUnavailable: false`, `allowUnsandboxedCommands: false`, `autoAllowBashIfSandboxed: false`.
- **The status item:** the sandbox reports nothing in the stream. On Linux, Eva looks for `bwrap` and `socat`. On native Windows, the sandbox needs a feature gate and an admin step, so Eva counts it as off. An alert says so, with the reason. A pi chat never has a shell wall: the guide says so.
- **pi:** the adapter checks `read`, `write`, `edit` and `ls` by `path`, and `find` and `grep` by `path` and their pattern, before it allows a tool call in project mode.
