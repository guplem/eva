# Plan: the conversation in the EVE style (#171)

## Why

The owner chose the EVE design for the web page (#161). The conversation is the page that people use most. Today it shows plain messages, a row of 9 px badges, text buttons and a plain text box. The design folds the agent steps into one line, shows a working state, and puts the engine, the model and the mode in the composer.

## What changes

- `client/Conversation.tsx`: bubbles, the visor beside each answer, the working line, the ghost actions (Retry, Fork, Copy), the composer card.
- `client/TurnSteps.tsx`: the folded step line and the step list.
- `client/Composer.tsx` (new): the text box, the engine and model chip, the mode chip, and Send or Stop.
- `conversation.css` (new): the styles of these parts. A file of its own keeps the change apart from the app shell work of #167.
- API: `POST /api/sessions/:id/engine` and `POST /api/sessions/:id/model`, on top of `SessionManager.setEngine` (new) and `SessionManager.setModel` (exists, Telegram uses it).

## Gaps and decisions

1. **Where the chips pick the engine and model.** A chat exists before its first message ("New chat" makes it). So the chips change the chat's engine and model while it has no turn. After the first turn they are read-only, because a model belongs to a conversation (lesson 41). A tap on a read-only chip opens the same menu with the reason, because a phone has no hover for a tooltip. The chip also has a `title` for a computer.
2. **A fork's chips.** A fork continues its chat's engine session, so the chips of a fork are read-only too. `setEngine` refuses a fork.
3. **Which engines the menu offers.** The engines that Eva found at start, from `GET /api/settings/setup` (`engines`). The menu reads it when it opens. The chat's own engine always shows.
4. **An engine that is not on the machine.** `setEngine` refuses it with `engine_failed`, as a turn does.
5. **Send and Stop.** Eva queues a message sent while a turn runs. So while a turn runs, the round button is Stop when the box is empty, and Send when the person typed text. This keeps the queue and puts Stop at the place of Send.
6. **Time on the step line.** A turn stores only its end time, so a stored answer shows the step count with no time. A running turn shows "Working · 8 s", measured on the page from its first sight of the turn. The time of the user's message is left out for the same reason.
7. **`+N −N` on edits.** No step carries line counts today. The step list leaves them out. A later issue can add the counts to the steps.
8. **Icons of the steps.** A message has the chat icon, a command the terminal, a tool the bolt, a task the sync icon. A failed step has the cross, in red. The step kinds stay the stored names.
9. **Messages before the last one.** The step list holds every step but the last message, in order. An earlier message is one line in the list. "Show the whole answer" stays for the full text.
10. **The live turn.** It shows the step line with the list open, the latest message, and the working line. When the turn ends, the stored answer shows the line folded.
11. **The visor's face.** A running turn with no text yet: thinking. A running turn in project mode with text: focused. Otherwise neutral. On a phone the visor hides, as in the reference.
12. **Copy.** Copy copies the text that the bubble shows: the last message, or the whole answer when it is open. The button says "Copied" for 2 s. Without the Clipboard API (a page over plain HTTP), it falls back to a hidden text box and `execCommand("copy")`.
13. **Attach.** Eva takes no files in a chat, so the composer has no Attach button.
14. **The mode chip.** A soft chip with "Assistant" or "Project". A chat cannot change its mode, so the chip is no button.
15. **The activity chip ("1 command, 1 tool").** The step line replaces it. The step line's `title` keeps the activity text.
16. **Background tasks.** The task button under the answer and the running-tasks button stay, as ghost buttons with the sync icon.
17. **Streaming (#117) and turn notes (#157).** The live message keeps its own block, and the notes keep their place under the branch, so both can grow there.
18. **The sidebar's "Model for a new chat".** It belongs to the chat list (#167). It stays, so this change does not touch the list.
