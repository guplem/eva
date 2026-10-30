# Plan: mention or attach a file in a chat in a clone (#706)

## Goal

In a chat in a clone, the person mentions a vault file with `@`, or attaches a file. Eva copies it into the clone, outside every repository, and the agent gets a note with the copy's path. No vault path reaches the agent.

## Changes

1. **Shared mention syntax.** The pure token rules (`mentionToken`, the token pattern as a function, a parse function) move from `src/frontends/web/client/mentions.ts` to `src/shared/mentions.ts`. The web code keeps its notes and its project helpers.
2. **Clone files.** A new core module, `src/core/projects/clone-files.ts`, owns the folder `clone-<n>/.mentions/`:
   - copy a vault file into it, or save a received file into it, named by content: `<name>-<hash><extension>`, as `saveReceivedFile` names a received file (one shared helper);
   - refuse a path outside the vault, a folder, a secret file (by its typed name and its real name) and a file under `Projects/*/repos/`;
   - rewrite the `@file:` tokens of a text to the copy names, with one note for each, and a note for a file that is gone or refused.
3. **The turn.** `TurnPreparer` gets an optional `engineMessage(session, text)`. `SessionManager.runTurn` calls it after `prepare`, while the turn holds the folder. `ProjectPreparer` uses it for a chat in a clone. The stored turn keeps the text as sent.
4. **Sending.** A new core check, `Eva.checkMessage(sessionId, text)`, throws an `EvaError` with an existing code (`file_not_found` or `file_not_downloadable`) when a mentioned file is gone or refused. The messages route and Telegram call it before they send. Telegram answers in the topic.
5. **Attachments.** `Eva.receiveFile(name, bytes, sessionId)` saves into the clone for a chat in a clone, and into `Scratch/received/` otherwise, with the matching note. The web route takes an optional `session` parameter. Telegram's `forwardFile` calls `Eva.receiveFile` with the topic's chat.
6. **The picker.** `searchFiles` gets an option that leaves out `Projects/*/repos/` and secret files. The composer of a chat in a clone uses it, shows no project choice and adds no mention note: the core does.
7. **The clone.** `holdsLocalWork` ignores `.mentions/`. A reuse removes it after its checks pass. A fork or a retry into another clone, new or reused, copies it along.
8. **Summaries.** Before a summary of a chat in a clone, each `@file:` token becomes its base name, so a summary names no vault folder.

## Gaps and decisions

1. **Where the text changes.** `runTurn` already gives the engine text that the turn record does not keep: `messagePrefix`. Decision: an optional `engineMessage` step, called after `prepare` and after the folder lock, since it writes into the clone. It runs on the whole text of the turn, from any sender: a request of project work can mention a file too, and the same checks apply. The turn record keeps the text as sent, so a retry copies again from the vault.
2. **Token rules.** `shared` imports nothing of ours, and `mentions.ts` imports web types. Decision: only the pure parts move.
3. **A gone file.** Decision: one core check with existing error codes, which the route maps to 404 and 409 as today, so no new sent name. Telegram runs the same check and answers in the topic ("Every problem must reach the phone"). A file that goes between the check and the turn gets a note.
4. **Refused files.** Decision: the core refuses a secret file, a folder, a path outside the vault and a file of another clone, whatever the picker shows. It reads the bytes as they are, with `resolveInVault`, and copies no redacted text.
5. **The picker.** The vault search stops at 100 matches, so a filter in the browser can show nothing. Decision: a server-side option.
6. **Copy names.** Decision: name by content, as `saveReceivedFile` does (lesson 74). The same bytes get the same name, so a retry or a second mention adds no copy, and two writers never collide. The name always ends with a hash, so no copy is an instruction file in any case, which lesson 2 needs.
7. **Specialist chats.** They do not exist yet (#703). The change keys on `session.clone !== null`.
8. **Project mode.** The core now adds notes to a Project chat's message. They hold only the person's own files, and only when the person mentions or attaches one. The PR says so for the owner.

## Tests

- `clone-files.ts`: copy, content names, refused paths, rewrite, notes, received file.
- `SessionManager`: the engine gets the rewritten text, the turn record keeps the sent text.
- `Eva.checkMessage` and the messages route; Telegram's text check and `forwardFile` for a chat in a clone.
- `searchFiles` with the clone option.
- `holdsLocalWork`, reuse, and a fork into a new and a reused clone.
- The summary of a chat in a clone names no vault folder.
- The composer and the picker in a chat in a clone.
