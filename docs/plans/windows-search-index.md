# Plan: the vault in the Windows Search index (#942)

## Goal

On Windows, Eva adds her vault to the Windows Search index, so the Start menu finds its files. She excludes git-ignored entries, `.git` folders and secret files. She keeps the rules up to date.

## Facts from a test on a real Windows 11 computer

- A process without administrator rights can add and remove user scope rules, and save them (`ISearchCrawlScopeManager`).
- `SaveAll` can hang for hours. Then the Windows Search service hangs too. So Eva runs the sync in a child process with a 60 s timeout, and calls `SaveAll` only when a rule changed.
- Rules from a `SaveAll` that did not end are lost. So Eva checks the rules at each start.
- The service rewrites a stored URL (a trailing `\`, no trailing `*`). So the script compares a normalized key.
- A `*` pattern matches one folder level only. So Eva gives one folder rule for each real ignored folder.
- `fOverrideChildren=1` deletes the exclude rules below. So the script always passes `0`.
- An exclude that comes after an include leaves the file in the index for a while. So the script adds the include and the excludes in one `SaveAll`.
- The Start menu finds `.md` and `.ts` files by name, not by text. Windows has no text filter for them, and a filter needs administrator rights. Out of scope.

## Design

- `src/core/files/windows-search.ps1`: the sync script. Input: a JSON file with the vault path, the exclude paths and a remove flag. Output: one JSON line. Exit codes: 0 ok, 1 bad input, 2 the Search API is missing, 3 a rule call failed, 4 `SaveAll` failed.
- `src/core/files/windows-search.ts`:
  - `searchExclusions`: the exclude list. The vault `.git/`, the vault's git-ignored entries except the `Projects/*/repos/` folders, the vault's secret files, and for each clone repository its `.git/` and its git-ignored entries. At most 1000 rules.
  - `runSearchScopeSync`: writes the script and the input to the state folder, and runs PowerShell through the `ProcessRunner` with a timeout.
  - `SearchIndexSync`: runs one sync at a time. A request during a sync runs one more sync after it.
  - `searchIndexProblem`: the problem for a result. A timeout or a failure is a warning. A missing Search API is no problem.
- `Eva`: an optional `searchIndex` option. Eva asks for a sync at start, after a clone appears or goes, and after a turn of a Project chat ends (a turn can make `node_modules`).
- `main.ts`: sets the option on Windows only.
- `install/uninstall.ps1`: runs the script that Eva wrote, with the remove flag, for each Eva that it stops.

## Decisions

- No setting: the person decided that Eva does it by herself.
- A turn end asks for a sync because a new clone has no `node_modules` yet. The sync saves only when a rule changed.
- The uninstall reuses Eva's own script, so the C# code has one home.
