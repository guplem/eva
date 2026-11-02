# A chat in a clone reads the notes of its own project (#774)

## Motivation

Since #711, a chat in a clone opens only its clone folder. The person must mention a note to give the chat a copy. The person wants the chat to read the plans and decisions of its project by itself, but still write only in its clone, and never see the other clones.

## Changes

1. `src/shared/path-area.ts`: add a read-only kind of folder to `WallFolders`, `readOnly`. Any folder can be read-only, such as a project folder inside the vault, or later the `.eva/scratch/received/<project-id>/` folder of #768. The order of the checks:
   1. A path in the area or an `open` folder: allowed, as now.
   2. A path in, or holding, a closed folder that lies inside a read-only folder: refused. This keeps `repos/` closed inside the project folder.
   3. A path in a read-only folder: allowed for a read, refused for a write.
   4. A path in, or holding, any other closed folder: refused, as now.
      `wallRefusesCall` passes its `write` flag to the path and pattern checks.
2. `src/shared/engine-port.ts`: `FileWall` gets the same `readOnly` list. The file tools read it through `WallFolders`, and the shell through the sandbox.
3. `src/engines/claude-code/claude-code-file-wall.ts`:
   The sandbox adds the read-only folders to `allowRead`, never to `allowWrite`. A closed folder inside a read-only one goes to `denyRead`, as `<project>/repos/`. On macOS it goes as the glob `<project>/repos/**`, with each glob character of the path turned into `?`, as `hiddenInstructionPatterns` does.
4. `src/core/modes/project-mode.ts`: for a chat in a clone, the wall gets the project folder as read-only and `<project>/repos/` as closed. Before each turn, `prepare` writes `<project>/repos/AGENTS.md` with one line, only when it is missing or its text differs. A specialist chat does not change.
5. Docs: the goal "Project mode is a clean wrapper" in the root `AGENTS.md` names the line. `docs/guide/reference.md` (_Clones and chats_, _The file wall_) and the README's answer about the wall say what a clone chat can read.

## Gaps and decisions

The owner is away. Each decision below follows his intentions: simple, one place per fact, existing users safe.

- **Where the chat learns about the notes.** Decision: as the issue assumes, the Eva-owned, git-ignored file `<project>/repos/AGENTS.md`. Both engines already read it (checked: `projectInstructionFiles` in Claude Code, `isAbove` in pi's filter). The text: "The notes of this project are in the project folder, two levels above each clone (`../../` from the clone folder). Read them when they help. Never write there: write only in the clone." Reason: the owner approved this in Round 2 (R4).
- **A search with a file tool from the project folder.** A Grep or a Glob of `../..` holds `repos/`, so the file tools refuse it, as they refuse any search that holds a closed folder today. A tool cannot skip a folder in its search. Decision: keep the refusal. The shell search (`ls ../..`, `grep -r ../..`) works and skips the other clones, since the sandbox hides them. A Read of a note and a search of a folder of notes, such as `../../decisions/`, work. Reason: no other clone is ever read, with no new code to rewrite a tool's input.
- **The shell on Linux and macOS.** Decision: the literal `repos` folder on Linux, which the issue's run of the sandbox checked, and the glob `repos/**` on macOS, which keeps the own clone open there. Windows has no sandbox. Reason: each system gets the form that the issue says works there. A glob on Linux expands into one mount for each match, which the issue did not check.
- **Glob characters in a macOS path.** Claude Code's globs take no escape that Eva can count on. Decision: turn each glob character into `?`, as `hiddenInstructionPatterns` does. A `?` can also match a sibling folder with a similar name, which only closes more.
- **A question for each read in a mode other than Auto.** Eva runs Claude Code only in Auto or in bypass mode (`ClaudePermissionMode`), and an untrusted clone always in Auto. The bypass mode asks nothing. Decision: no change, and no `additionalDirectories`, which would also open the folder to writes and to its skills.
- **When the file is written.** Decision: in `prepare` only, before the engine starts. The chat details read the file once it exists, so they list it from the first turn on. Reason: `describe` stays free of writes.
- **A file in `repos/` and the clone list.** `listClones` lists only `clone-<n>` folders, so the file changes nothing there. No new sync rule: the vault's `.gitignore` line `Projects/*/repos/` keeps the file out, as it keeps the clones out.
