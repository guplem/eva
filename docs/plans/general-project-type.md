# The `general` project type, and every chat takes files (#768)

## Motivation

A project of notes and files with no code, such as building a house, fits neither type today. As software it gets no chat, and as a specialist it gets rules it does not want. The owner decided: three types, `general`, `software` and `specialist`; no type means general; a general chat starts in the project folder like a specialist chat; every kind of chat takes attached files, which land in a temporary folder first.

## Changes

1. `src/shared/project-types.ts` (new): `ProjectType` (`general | software | specialist`), the list of types, and `worksInClones(type)`, true only for software. Core and the web page share it. Each `type === "specialist"` that means "no clones" becomes `!worksInClones(type)`.
2. `project-catalog.ts`: `parseFrontMatter()` reads no `type` as software when `repos` has an entry, and as general otherwise. The warnings of a project with no clones name its type ("a general project has no clones, ...").
3. `project-file.ts`: a Details save writes the `type` key for every type. A save of a file with no key writes the type that it reads as now, so a `repos` change alone never changes the type.
4. `new-project.ts`, `project-work.ts`: a general project is created and opened like a specialist, but with no `newSpecialistLine` and no first chat. `checkTypeChange()` lets general and specialist switch while the project has chats. `noClones()` names the type. A general project with `repos` gets the warning and no clone.
5. File intake: `Eva.receiveFile()` saves a file for a chat with no clone in `.eva/scratch/received/<project-id>/` with `saveReceivedFile()`. A gone project takes no file. The Telegram bot and the web composer allow files in every chat. `SpecialistPreparer` adds that folder to the wall's `readOnly` list (#774 added the kind in both engines), so the chat reads it with its file tools and shell, but cannot write it.
6. Labels: `chatKindName()` takes the project type. A chat with no clone in a general project is "Project", in a specialist "Specialist". The ChatPanel Mode line, the ProjectView chip and the Telegram chat list pass the type.
7. Texts: the work place "project folder" (`reportPlace`, `eva work`), the busy-folder notice, the CLI help, the web form (General first and picked, Drive and no repository), the Details editor (three types, a new hint), the project card ("General · 3 chats"), `ProjectPage.tsx` texts for a general project, the base prompt's Projects lines, `docs/guide/reference.md`, the root `AGENTS.md` goal, `templates/vault/AGENTS.md`.
8. Migration `2026-11-02-general-project-type` (vault): adds `type: software` to each vault project with `repos` and no `type`, and fixes the three exact lines of an old vault map (type line, "one of two types", the General bullet above Eva's exact Software bullet).

## Gaps and decisions

The owner is away. Each decision follows his intentions: simple, one place per fact, existing users safe.

- **Assumptions 1 to 15 of the issue.** Decision: accept them all, with R3 of round 2 for file intake. Reason: they follow the owner's decisions and keep old projects working.
- **What the wall opens for received files.** The issue says both "the subfolder" and "the chat keeps the paths of the files sent to it". Decision: open the whole subfolder `.eva/scratch/received/<project-id>/` read-only, and keep no list of paths on the chat. Reason: the subfolder holds only files sent to this project, so a list adds a stored field and gains nothing. It also needs no session record change.
- **Where `ProjectType` lives.** The web page and the core both need `worksInClones()`, and the web may not import core code at run time. Decision: a small `src/shared/project-types.ts`, as `project-statuses.ts` does for statuses. Reason: one home for the list.
- **The label of a chat with no clone in a gone project.** Decision: "Project". Reason: only a specialist project shows "Specialist"; a neutral word fits a project that no longer exists.
- **The preparer's check at each turn.** It refuses a chat whose project became software. Decision: keep the check, and reword its message to "This project works in clones now, ...". Reason: the old text says "no specialist", which is false for a general project.
- **The base prompt.** #769 edits the same Projects section. Decision: change only the type lines, with the approved text of #771 for them. Reason: small edits limit the conflict.
- **The extra-root warning.** A general or specialist project outside the vault gets no chat. Decision: one warning that names the type. Reason: the same rule for both types.
