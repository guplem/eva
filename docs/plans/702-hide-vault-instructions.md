# Plan: hide the vault's instructions from every Project chat (#702)

## Goal

A Project chat loads no instruction file from a folder above its project folder. It still loads the project's own `AGENTS.md` and everything below it.

## Changes

1. **Turn request.** `PreparedTurn` and `TurnRequest` get `projectFolder: string | null`. `ProjectPreparer` sets it with one helper next to the clone code: the start folder for a chat with no clone (a specialist chat of #703), else the parent of the clone's `repos/` folder. Assistant turns and model calls set null.
2. **Claude Code, trusted clone.** `buildQueryOptions` sets `settings.claudeMdExcludes` to the instruction files of each folder strictly above the project folder: `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `AGENTS.md`, `.claude/AGENTS.md` and `.claude/rules/**`. It writes the patterns for the folder path as given and for its real path.
3. **Claude Code, untrusted clone.** `instructionFilesText` stops its walk at the project folder.
4. **pi.** A new pi extension, `pi-context-filter.ts`, loads in each Project chat with `-e`. It reads the project folder from an environment variable once, and deletes it, as the MCP bridge does with its file. On `before_agent_start`, it removes from the system prompt each context file whose folder is strictly above the project folder. When it cannot do so, it sends a notice to the chat.
5. **Goal and docs.** `AGENTS.md` gets the new goal text. Update the comments, `docs/guide/reference.md`, `docs/design/eve/reference.html` and lesson 39. Add one rule line to `src/core/modes/AGENTS.md`.

## Gaps and decisions

1. **How the engines learn the project folder.** A new field on the turn request, set by the core. Engines may not import the core (`.dependency-cruiser.cjs`), and the issue says that an engine does not work the folder out from the vault layout. `ProjectPreparer` already derives a folder from the start folder (`withGitCeiling`). The helper branches on the chat's clone, so #703 needs no second rule: `dirname(dirname(startFolder))` would be wrong for a chat that starts in the project folder.
2. **pi: `--no-context-files` or an extension.** The issue assumes `--no-context-files` plus `--append-system-prompt`, and asks to check two points. pi 0.73.1 answers them:
   - `--append-system-prompt` replaces the person's own `APPEND_SYSTEM.md` (`resource-loader.js`);
   - `--no-context-files` also removes pi's global context file.

   pi's extension event `before_agent_start` gives the assembled prompt and the loaded context files, and its result replaces the prompt for the turn. Each file shows as `## <path>\n\n<content>\n\n` under `# Project Context`. Decision: Eva's extension removes the blocks of the hidden files. This keeps the issue's goal and each "Done when" item, keeps the person's `APPEND_SYSTEM.md` and pi's global file, and adds no text of Eva. Lesson 40 holds: the removal is a pure function of pi's own prompt, which pi builds again at each turn.
   - **Input:** an environment variable, as the MCP bridge gets its file. The extension deletes it at load, so pi's shell tool does not see it. This also avoids pi's `registerFlag`, which an older pi may lack.
   - **Paths:** the extension compares real paths, and on Windows compares with no case and one kind of separator. pi's working folder is a real path.
   - **Failure:** when the event has no list of context files, or a hidden file's block is not in the prompt, the extension sends a notice with its own prefix. The adapter shows it, as it shows the MCP bridge's notices ("Every problem must reach the phone").
   - **Code form:** the handler lives in its own `.ts` file, imported as text by a small module, as `pi-mcp-bridge.ts` is. A test runs the handler with a fake pi.

3. **Glob characters in a folder path.** Claude Code matches `claudeMdExcludes` with picomatch. It turns each backslash into a forward slash, in the paths and in the patterns, so a backslash escape cannot work. Decision: write each pattern with forward slashes, and replace each of `( ) [ ] { } * ? ! + @` in the path with `?`, which matches any one character but never `/`. picomatch matches case, so a Windows drive letter becomes `?` too. A widened pattern can only reach an instruction file of a folder above the project with nearly the same name. It can never reach the project's own files.
4. **pi does not load a subfolder's file during a turn.** pi 0.73.1 loads its context files once, at start (`loadProjectContextFiles`). So the extension covers every file.

## Known limits, for the PR

- A trusted clone's own pi extension that calls `setActiveTools` rebuilds pi's prompt with the hidden files until the next turn.
- A Claude Code chat from before the change keeps in its history the files that it read at its start.
- Claude Code never excludes a managed policy file.
- No run with a real `claude` on Windows yet.

## Tests

- The helper gives the project folder for a chat in a clone and for a chat with no clone. `ProjectPreparer` passes it on.
- `buildQueryOptions` pins `claudeMdExcludes` for a trusted clone. The Assistant and model-call settings stay as they are.
- The exclude patterns use forward slashes, replace glob characters and the drive letter, and add the real path. They never match the user-level config folder.
- `instructionFilesText`, through the untrusted options, stops at the project folder.
- `buildPiArguments` loads the context extension in project mode only. The pi engine passes the project folder in the extension's variable.
- The extension removes a hidden file's block, keeps the others and the global file, drops the `# Project Context` header when no file is left, and sends a notice when it cannot remove a block.
