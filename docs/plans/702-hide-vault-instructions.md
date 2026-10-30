# Plan: hide the vault's instructions from every Project chat (#702)

## Goal

A Project chat loads no instruction file from a folder above its project folder. It still loads the project's own `AGENTS.md` and everything below it.

## Changes

1. **Turn request.** `PreparedTurn` and `TurnRequest` get `projectFolder: string | null`. `ProjectPreparer` sets it to the project folder of the clone. Assistant turns and model calls set null.
2. **Claude Code, trusted clone.** `buildQueryOptions` sets `settings.claudeMdExcludes` to the instruction files of each folder strictly above the project folder: `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `AGENTS.md`, `.claude/AGENTS.md` and `.claude/rules/**`.
3. **Claude Code, untrusted clone.** `instructionFilesText` stops its walk at the project folder.
4. **pi.** Eva's pi extension registers the flag `--eva-project-folder`. On `before_agent_start`, it removes from the system prompt each context file whose folder is strictly above that folder. The adapter passes the flag in project mode.
5. **Goal and docs.** `AGENTS.md` gets the new goal text. Update the comments, `docs/guide/reference.md`, `docs/design/eve/reference.html` and lesson 39. Add one rule line to `src/core/modes/AGENTS.md`.

## Gaps and decisions

1. **How the engines learn the project folder.** Decision: a new field on the turn request, set by the core. `ProjectPreparer` derives it as the parent of the clone's `repos/` folder. This holds for both clone forms: `repos/clone-<n>/` and the old one-repository `repos/<name>/`. The vault layout is a contract (`AGENTS.md`), and the core already owns it.
2. **pi: `--no-context-files` or the extension.** The issue assumes `--no-context-files` plus `--append-system-prompt`. pi 0.73.1 shows two problems with that:
   - `--append-system-prompt` replaces the person's own `APPEND_SYSTEM.md` (`resource-loader.js`: `appendSystemPromptSource ?? discoverAppendSystemPromptFile()`);
   - Eva would have to copy pi's rules for which file each folder gives (`AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`, first one wins) and pi's prompt format.

   pi's extension event `before_agent_start` gives the assembled system prompt and the list of loaded context files, and its result can replace the prompt for the turn. Each file shows as `## <path>\n\n<content>\n\n` under `# Project Context` (`system-prompt.js`). Decision: Eva's own extension, which pi loads on every turn, removes the blocks of the hidden files. This reaches the issue's goal and keeps the person's `APPEND_SYSTEM.md`, pi's global context file and pi's format. A turn with no hidden file keeps the prompt unchanged.

3. **Glob characters in a folder path.** Claude Code matches `claudeMdExcludes` with picomatch, after it turns backslashes into forward slashes. It does not change the pattern. Decision: write each pattern with forward slashes, and replace each glob character of the path with `?`, which matches any one character. This needs no escape rule that may differ on Windows. It can only widen a pattern by one character at that place, to an instruction file of a folder with nearly the same name above the project. No such folder is a project folder, so the project's own files stay loaded.
4. **pi does not load a subfolder's file during a turn.** pi 0.73.1 loads its context files once, from the start folder up (`loadProjectContextFiles`). So the extension covers every file.

## Tests

- `ProjectPreparer` sets the project folder for both clone forms.
- `buildQueryOptions` pins `claudeMdExcludes` for a trusted clone, and no settings change for the Assistant.
- The exclude patterns replace glob characters, and use forward slashes.
- `instructionFilesText` (through the untrusted options) stops at the project folder.
- `buildPiArguments` passes `--eva-project-folder` in project mode only.
- The extension source removes a hidden file's block, keeps the others, and drops the `# Project Context` header when no file is left. The test runs the extension's handler on a sample prompt.
