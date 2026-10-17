# Plan: show web and terminal chats in Telegram (issue #9)

This file is the working plan for the pull request. The last commit of the pull request deletes it.

## Goal

Every chat of an instance is reachable from Telegram. One conversation list serves every front end (ADR 0004: "One conversation list per instance. Every front end shows the same list.").

## Today

- The bot knows only the topics that it opened (`state.topics` in `src/frontends/telegram/telegram-bot.ts`).
- A web or `eva chat` chat never shows in Telegram. Only its approvals reach the main chat.
- `/delete` deletes the topic, but the session record stays, so the web list still shows the chat.
- No front end can delete a session. The core has no delete.
- `eva work` starts project work (`Eva.startProjectWork`). Telegram posts no link to the Project chat.
- The web UI has no deep link to one chat.

## Acceptance criteria (from the issue)

1. A chat started in the web UI can be continued from Telegram, and its answers appear there.
2. A Telegram topic and its web chat show the same history.
3. Deleting a chat in one front end removes it, or marks it removed, in the others.
4. When the assistant gives work to a project from a Telegram chat, Telegram posts a link to the Project chat.

## Gaps

- **A. How a non-Telegram chat reaches Telegram.** Open a topic for each chat at once, or open one on request (a `/chats` list with buttons)? How does a topic show messages typed in another front end, and the turns before it opened?
- **B. Delete semantics.** Remove the record, or mark it removed? What happens to forks of a deleted chat, to a busy chat, and to the engine transcript? Which front ends get a delete action?
- **C. How front ends learn that the chat list changed.** A new core event, or a reload?
- **D. The project-work link.** Which link (Telegram topic, web URL, both)? How does the bot learn that a Telegram chat started project work? Does the web UI need a deep link?

## Decisions

To be filled after the gap research.

## Steps

To be filled after the decisions.
