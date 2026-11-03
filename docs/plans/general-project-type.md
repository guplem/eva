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
- **The label of a chat whose project Eva does not know.** Decision: the kind's name, "Specialist", as today. Reason: no type to follow, and no change for a case that the issue does not name.
- **When a Details save writes the type.** Assumption 1 says that a save of a file with no key writes the type. Decision: write it when the type changes, or when a change of `repos` would move the default. A save that changes nothing else leaves the file byte for byte. Reason: the type never changes by itself, and the person's file gets no churn.
- **The New chat menu item of a general project.** The issue proposes "New chat", but the menu button already says New chat. Decision: "In the project folder", beside "In a clone". Reason: the item says where the chat runs, as the others do.
- **The line that says a received file is temporary.** Project mode adds no prompt, so there is no general or specialist prompt to hold it. Decision: the note of the file carries it, for a chat in a project folder only: "saved as <full path>. It is temporary and read-only: to keep it, copy it into the project folder." Reason: the clean wrapper stays, and the line reaches the agent with the file.
- **The preparer's check at each turn.** It refuses a chat whose project became software. Decision: keep the check, and reword its message to "This project works in clones now, ...". Reason: the old text says "no specialist", which is false for a general project.
- **The base prompt.** #769 edits the same Projects section. Decision: change only the type lines, with the approved text of #771 for them. Reason: small edits limit the conflict.
- **The extra-root warning.** A general or specialist project outside the vault gets no chat. Decision: one warning that names the type. Reason: the same rule for both types.

## Review decisions

The reviews ran in five rounds. Each finding below is fixed, or kept with its reason.

- **Fixed:** the guide's type-change sentence of a specialist, and the General bullet now names its warnings and how `type: general` keeps a project general when it gets `repos`.
- **Fixed:** the busy vault sentence says "an Assistant or project chat", so it covers a general chat.
- **Fixed:** the daily clean removes the empty project folders inside `.eva/scratch/received/`. The received folder and `.eva/scratch` stay.
- **Fixed:** Telegram checks that the chat's project exists before it downloads a file.
- **Fixed:** a raw save that adds `repos` to a general project with no type key, while it has chats, says that the repos make it software and that `type: general` keeps it general.
- **Fixed:** the Details form reads a missing type as general for its unsaved-changes check, as it shows it.
- **Fixed:** the migration reads only folders named by a project id, with a frozen copy of the rule.
- **Fixed:** the root goal says that a chat in a project folder reads the files sent to its project.
- **Fixed:** a folder chat of a software project, left from an older type, stays "Specialist". Only a general project's chat is "Project".
- **Fixed:** the merge of #769: a new project file starts with `created`, `summary`, `status` and `type`, in that order.
- **Kept:** the menu label "In the project folder", since the button already says New chat.
- **Kept:** the vault map comment "No type means general". #772 replaces the map, and the base prompt states the `repos` rule.
- **Kept:** a malformed scalar `repos` reads as general. The warning still shows.
- **Kept:** the note of a received file differs from the Assistant's. A chat in a project folder gets no prompt of Eva's, so the note carries the line.
- **Fixed:** the e2e test "a right click on a project opens its pages from the menu" timed out on the phone. The desktop run's new projects, a general one among them, push the card down, so the project list scrolls. A refresh of the list while earlier chats end scrolls it again, and a scroll closes the menu, as designed. The test now waits until no chat works, and retries the right click and the pick.
