# Plan: show web and terminal chats in Telegram (#9)

This is a working plan. Delete it before the merge.

## Goal

One conversation list serves every front end. Today the Telegram bot knows only the topics that it opened (`state.topics` in `src/frontends/telegram/telegram-bot.ts`). This plan makes every chat of the instance reachable from Telegram, keeps one history, and makes a delete reach every front end.

## What exists

- `SessionManager` (`src/core/sessions/session-manager.ts`) holds every chat. The web and `eva chat` read it through the local API. It has no delete.
- The bot maps `<chatId>:<topicId>` to a session id. An event for an unknown session reaches Telegram only when it is an approval.
- `/delete` deletes the Telegram topic and forgets the mapping. The session record stays, so the chat still shows in the web list.
- `eva work` (`Eva.startProjectWork`) starts a Project chat and reports its result to the Assistant chat in `EVA_SESSION_ID`. Telegram learns nothing of the Project chat.
- The web app has no address for one chat: it opens on the newest chat.

## Steps

1. **Core: delete a chat.** `SessionManager.delete(id)` removes the chat and its forks from the store. It refuses a busy chat with `session_busy`. It tells the listeners with a new event.
2. **Core: the "chats changed" events.** A new session event kind tells the front ends that a chat was deleted. A second kind tells the front ends that project work started from a chat.
3. **API and web: delete.** `DELETE /api/sessions/:id`. A delete button in the chat header of the Assistant view and the Project view, with a confirm. The web reloads the list on the delete event.
4. **Telegram: `/delete` deletes the chat.** After the topic delete, the bot deletes the session in the core. On a delete event from another front end, the bot deletes the topic, or forgets the main chat's mapping.
5. **Telegram: reach every chat.** See gap 1.
6. **Telegram: one history.** See gap 2.
7. **Telegram: the link to the Project chat.** See gap 4.
8. **Docs.** Update `README.md` ("In Telegram") and `docs/guide/reference.md` for the new behavior.

## Gaps

### Gap 1: how a web or terminal chat reaches Telegram

- **A. Mirror every chat.** At the first turn of any chat that has no topic, the bot opens a topic for it. Every chat shows in Telegram, but each web chat and each Project chat adds a topic.
- **B. On demand: a `/chats` command.** It lists the recent chats as buttons. A press opens a topic for that chat (or points to its topic), and binds it. From then on, the topic shows every turn of the chat.

Proposal: B. It meets "can be continued from Telegram" without a topic for each chat. Gap 4 adds a topic for a Project chat that a Telegram chat started.

### Gap 2: the same history in a topic and in the web chat

- When a topic opens for a chat that has turns, the bot posts the past turns. How many?
- A message that the person sends to a bound chat from the web is not in Telegram. Proposal: at the end of a turn that did not start from Telegram, the bot posts the person's message first, then the answer.
- What about a turn that no person started (a project report, a follow-up of the mode)?

### Gap 3: delete or mark removed

- **A. Delete the record** (and its forks). Simple; the engine keeps its transcript.
- **B. A `removed` flag** on the record, read tolerantly. A stored field: a schema change.

Proposal: A. Also: does the web get a delete button in this issue, or only Telegram?

### Gap 4: the link to the Project chat

- **A. A Telegram topic link.** The bot opens a topic for the Project chat and posts `https://t.me/c/<id>/<topic>` in the asking chat. It works only in a group with topics.
- **B. A web link.** The web app gets an address per chat (for example `#/chat/<id>`). The bot posts the remote address with it. It needs Tailscale for a phone.

How does the bot learn that the work started from a Telegram chat? Proposal: `startProjectWork` emits a `project_work_started` event on the asking chat, with the project id and the Project chat id.

## Decisions

To fill after the gap review.
