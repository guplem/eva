# Plan: let the person set how chats are named (issue 50)

## Today

- A chat takes the first line of its first message as its title, cut to 60 characters (`titleOf` in `src/core/sessions/session-manager.ts`).
- No model names a chat. The "chat name skill" in the issue does not exist yet.
- The person can rename a chat from the web page, Telegram and the terminal. A rename emits `session_renamed`, and Telegram renames the topic that Eva opened.

## Proposed design

1. Add an optional vault file, `.eva/chat-names.md`. It holds the person's naming rules as prose. Without the file, Eva keeps today's first-line title.
2. After the first turn of a chat ends, Eva starts one short naming call in the background when all of these hold:
   - the chat is not a fork,
   - the title is still the first-line title that Eva gave it,
   - the rules file exists.
3. The naming call copies the engine check in `src/core/checks.ts`: a new engine session in an empty folder, no prompt of Eva's own, no plugins, no MCP servers, approvals denied, and a timeout.
4. The call gets the rules, the first message and the start of the first reply. It asks for one line.
5. Eva applies the line through `SessionManager.rename()` only if the person did not rename the chat in the meantime. Any failure keeps the first-line title. The turn never waits for the call.
6. The web settings page gets a text box for the rules file, so the person can change the rules from a phone. The person can also ask Eva in a chat to edit the file.
7. The vault template gets a short example in its README, not the file itself, so a new vault has no extra model calls.

## Gaps

- **Project chats.** Project mode is a transparent wrapper. The naming call runs outside the clone and adds nothing to the project session, but it is still Eva's own model use on a project chat. Owner decision.
- **Cost and model.** Each new chat costs one more small turn on the person's subscription. Claude Code can use `haiku`. pi has no fixed cheap model. Owner decision.
- **Refresh.** Name once after the first turn, or again later. Proposed: once.

## Decisions

Waiting for the owner.
