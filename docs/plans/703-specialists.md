# Plan: specialists (#703)

A specialist is a project that the person chats with directly. Its chat starts in the project folder, and its only instructions are the project's `AGENTS.md`. The issue holds the decisions. This plan maps them to the code and lists the gaps.

## The model

- A specialist chat is a Project chat (`mode: "project"`) with `clone: null`. Today no code makes such a chat: every Project chat has a clone. So `clone === null` can mean "specialist" with no migration.
- One shared helper names the kind of a chat: Assistant, specialist or project work. Every place that reads `mode === "project"` as "has a clone" uses it.

## Work units

1. **Front matter `type`** (`src/core/projects/project-catalog.ts`): `software` or `specialist`. No key reads as software. Warnings: an unknown value, a specialist with `repos`, a specialist outside the vault. `Project.type` for every caller.
2. **Engine switches** (`src/shared/engine-port.ts`, both adapters, contract tests): new turn request fields for the harness's own memory and for the folder's hooks.
3. **Specialist turns** (`src/core/modes/`): a preparer for a specialist chat. No prompt, no plugin, no MCP server, trusted, the git ceiling, the project folder for #702. Around each turn, the vault pull, the snapshots and the save of Assistant mode, shared with `AssistantPreparer`.
4. **Session manager:** the preparer by chat kind. `takeFolder` holds a specialist folder too, with its own notice. A retry of a specialist undoes through the vault, never through a clone snapshot.
5. **Vault sync:** `assistantBusy` in `eva.ts` also counts specialist turns. `answersToUndo` counts specialist turns.
6. **Chats of a specialist** (`project-work.ts`, `eva.ts`): `createSession` makes a chat in the project folder. A fork and a retry stay in the chat tree, as for an Assistant chat. `continueFromSummary` makes a specialist chat. `eva work` runs a specialist chat, and the stored report gets a nullable `clone`.
7. **New project** (`new-project.ts`, API, web form): a type choice. A specialist gets no repository step, its `AGENTS.md` with one line under the front matter, and a chat.
8. **Project details:** the type can change while the project has no clones.
9. **Web app:** the specialist page (its chats, New chat, warnings, no clones). The composer turns off mentions and attachments. The retry undo works through the vault. Labels.
10. **Telegram and CLI:** the specialist label. A file sent to a specialist chat gets a refusal. The CLI `--project` opens a specialist chat.
11. **Texts:** the goal in `AGENTS.md`, `templates/vault/AGENTS.md` with a dated migration for existing vaults, `assistant-base-prompt.md`, `docs/guide/`.

## Decisions

The three gap agents agreed on each point below.

1. `src/shared/chat-kind.ts`: `chatKind(chat)` gives `assistant`, `specialist` or `project`, and `chatKindName` gives the shown word. `src/shared/` is the one layer that the core and every front end import.
2. `SessionManagerOptions.preparers` is keyed by chat kind. The manager reads `preparers[chatKind(session)]` at its three lookups. `ProjectPreparer` cannot serve a specialist: a folder with no repository counts as untrusted.
3. `harnessMemory` and `folderHooks` on the turn request and on `PreparedTurn`. The SDK types say that `disableAllHooks` covers the hooks of settings files and plugins, and that SDK callbacks keep running, so #711 can still add one.
4. `src/core/modes/vault-turns.ts` holds the pull, the snapshots and the save. `AssistantPreparer` and `SpecialistPreparer` both use it. The specialist preparer has no `snapshot`, `restore` or `forget`: the `session_deleted` listener already deletes its vault snapshots.
5. The `takeFolder` notice: "Another chat of this specialist runs a turn. This turn starts when that turn ends." The abort text names the specialist too. The Telegram label: "Specialist: ". The file refusal: "This chat takes no files."
6. `ProjectReport.clone` is `string | null`, and the store reads it as nullable. An older Eva drops the card of a specialist report and shows the raw message. `reportPlace` drops a null clone, and says "specialist" when nothing is left. The message keeps the `[Project work finished` prefix with the place "specialist".
7. The New project API takes `type`, with software as the default. A specialist with a repository or a Drive folder is refused. The result gets the chat that Eva opened, or the reason why she could not. The web form opens that chat.
8. A frozen vault migration replaces the exact old _Projects_ paragraph and the exact old YAML example. When the person edited them, it changes nothing.
9. The core refuses, for a specialist: a fork or retry in a new clone, a named clone, a received file, and a chat outside the vault. `continueFromSummary` reads no git state for a specialist. The web app sends a specialist fork straight to `api.fork`, and its retry with `{ undo }`. The project page gets a chat route with no clone.
10. `describe` shows no part of Eva's. The Claude Code context lists no "repository" part for a specialist folder (`startFolder === projectFolder`). The subtitle says "Specialist".
11. No vault links in a specialist answer: its paths start at its own folder, not at the vault root.

### Risks found

- The project details form changes the type only when the project has no clones and no chats. Otherwise a chat would change kind under the person.
- A vault snapshot covers the whole vault, so a specialist undo can take back an Assistant chat's writes from the same moment, as between two Assistant chats today (lesson 30). The PR says so.
- Before #707, a secret file in a specialist folder reaches the vault's remote in plain text, as in any project folder today. The PR says so.
- The vault upkeep texts that say "an Assistant chat" also cover a specialist chat.
- Claude Code still loads `.claude/skills/` from the folders above (lesson 5). The PR says so.

## Gaps

1. Where the chat kind helper lives, and its name, so the core and the web app share it.
2. How the session manager picks the specialist preparer. The `preparers` record is keyed by `SessionMode`.
3. The names and the shape of the two new turn request fields. Does `disableAllHooks` also turn off the SDK's own hook callbacks, which #711 may need?
4. How `AssistantPreparer` and the specialist preparer share the vault steps.
5. The text of the `takeFolder` notice and of the Telegram label for a specialist.
6. How the project report reads an old report, and how the Assistant's text shows a report with no clone.
7. What the New project API takes and returns for a specialist, and how the web app opens its chat.
8. How the migration changes the _Projects_ section of an existing vault map, which the person may have edited.
9. Which web screens and front end checks read `mode === "project"` as "has a clone", beyond those that the issue lists.
10. What the chat details (`describe`) show for a specialist chat.
11. Whether a specialist answer gets vault links in the web app.
