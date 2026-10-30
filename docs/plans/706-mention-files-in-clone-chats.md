# Plan: mention or attach a file in a chat in a clone (#706)

## Goal

In a chat in a clone, the person mentions a vault file with `@`, or attaches a file. Eva copies it into the clone, outside every repository, and the agent gets a note with the copy's path. No vault path reaches the agent.

## Changes

1. **Shared mention syntax.** The `@file:` and `@project:` token rules move from `src/frontends/web/client/mentions.ts` to `src/shared/mentions.ts`, so the core and the web app read the same tokens.
2. **Clone files.** A new core module, `src/core/projects/clone-files.ts`, owns the folder `clone-<n>/.mentions/`:
   - copy a vault file into it, with the path check and the size limit of `downloadVaultPath`;
   - save a received file into it;
   - give each copy a free name, and rename a copy of an instruction file (`AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`);
   - rewrite the `@file:` tokens of a message to the copy names, and add one note for each.
3. **The turn.** A `TurnPreparer` gets an optional step that turns the person's text into the engine's text. `ProjectPreparer` uses it for a chat in a clone. The stored turn keeps the text that the person typed.
4. **Sending.** The messages route refuses a message to a chat in a clone when a mentioned file is gone or not allowed, and names the file.
5. **Attachments.** `Eva.receiveFile` takes the chat. For a chat in a clone, it saves the file into the clone and gives the clone's note. The web route and Telegram pass the chat.
6. **The web app.** The composer turns on mentions and attachments for a chat in a clone. The picker there shows files only, with no file under `Projects/*/repos/` and no secret file. The browser adds no note: the core does.
7. **The clone.** `holdsLocalWork` ignores `.mentions/`. A reuse removes it. A fork or a retry into a new clone copies it along.

## Gaps and decisions

1. **Where the text changes.** The prompt reaches the engine through `SessionManager.runTurn`, after `prepare`. Decision: an optional `TurnPreparer.engineMessage(session, text)`, called there. The stored turn keeps the person's text, so a retry copies again from the vault, which is the newest file. Each mode keeps its own rules, as `prepare` does.
2. **Where the tokens are parsed.** The core may not import the web app. Decision: move the token rules to `src/shared/`, and import them from both sides ("Reuse a shared component").
3. **A gone file.** The API accepts a message with 202 before the turn runs. Decision: the route checks the tokens before it accepts, and answers 400 with the names. A retry later, or a Telegram text, gets a note that the file is gone instead.
4. **Secret files.** Decision: the core refuses to copy a file that `looksLikeSecretsFile` names, as `downloadVaultPath` does. #707 changes the list later.
5. **The picker.** It searches with `api.searchFiles`. Decision: the composer of a chat in a clone filters out `Projects/*/repos/` paths and secret files, and shows no project choice.
6. **Specialist chats.** They do not exist yet (#703). This change keys on `session.clone !== null`, so a chat with no clone keeps mentions and attachments off.

## Tests

- `clone-files.ts`: copy, size limit, path check, secret refusal, free names, instruction file rename, token rewrite, gone file note, received file.
- `ProjectPreparer.engineMessage`, and `SessionManager` sends the engine's text and stores the person's.
- The messages route refuses a gone file for a chat in a clone.
- `receiveFile` with a chat in a clone, and Telegram's `forwardFile` for such a chat.
- `holdsLocalWork`, reuse and fork with `.mentions/`.
- The composer and the picker in a chat in a clone (web unit tests).
