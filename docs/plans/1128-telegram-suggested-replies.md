# Plan: suggested replies in Telegram and the terminal (#1128)

## Motivation

#1127 lets Eva end an answer with `[[reply: <text>]]` lines, and the web chat offers them. Most people use Eva from Telegram on a phone. A one-tap reply matters most there. `eva chat` still prints the raw marker lines.

## Work

1. Telegram: a new module `src/frontends/telegram/telegram-replies.ts` keeps the offers in memory. The bot calls it at the turn end, at each turn start and at a button press.
2. Terminal: `createEventPrinter` hides the marker lines, also while the answer streams. It prints one line of suggested replies after the answer.
3. Docs: `docs/guide/reference.md` and `docs/guide/how-eva-works.md`.

## Decisions

Each decision comes from the issue, the web rule (`chatReplies` in `src/frontends/web/client/suggested-replies.ts`) or a solved case in the bot.

- **Source of the replies.** The bot parses the recorded answer of the turn (`lastAnswerOf`, or the waited answer of a late topic) with `extractFileMarkers`. The web parses the same text, so both front ends offer the same replies. Both turn-end paths use it.
- **Where the buttons go.** A short message of its own after the answer, the file offers and the usage lines, as `offerFiles` does. Its text is "Suggested replies:". One button for each reply, one button on each row, so a long reply stays readable. The message is quiet: the answer already rang the phone.
- **Which chats.** Only a chat with Eva (`chatKind` is `assistant`), and only a finished turn. A failed or stopped turn offers none. A Project chat, a specialist chat, the history of a new topic, a scheduled run and a notification offer none. A person's later turn in a schedule's topic is a chat with Eva, so it offers replies, as the web does.
- **The button data.** `p:<id>`, with a random id of 32 hex characters. Telegram allows 64 bytes. A random id never matches an old button after a restart, as a counter would.
- **A press.** The bot answers the press, edits the button message to "You replied: <text>" with no buttons, and sends the reply as a typed message from that topic (`forward`). The core then answers it as a normal message.
- **The offer ends at the next turn start.** At `turn_started` of the chat, the bot forgets the offer and deletes its message. This covers a typed message, a message from another front end and a follow-up turn of the mode. The web hides the replies while a turn runs, for the same reason. So a press while a turn runs, or after a newer answer, starts no turn.
- **A stale press.** A press on a forgotten offer gets the short note "This reply is no longer available." and starts no turn. This covers a press after a newer turn, a second fast press on the same message, a press after a restart, and a press in a topic whose chat changed. A press in a topic other than the topic of the offer does nothing, with the same note.
- **Order.** The bot registers the offer at the turn-end event, before any await. It sends the message later, in the chat's order. A turn start before the send makes the send skip. A turn start after the send deletes the message in the chat's order, after the send.
- **A new offer replaces an older one** of the same chat, with the same delete.
- **The prompt.** The section "Suggested replies" says "Some front ends offer them". This stays true, so it does not change.
- **Terminal.** `eva chat` hides each marker line, also `[[attach:]]` and `[[offer:]]`, with `shownAnswerText`. A streamed line that can start a marker waits until it is complete. After a finished turn of a chat with Eva, one line lists the replies: `Suggested replies: Yes · No`. The person types a reply as usual. A Project chat gets no line.

## Gaps

None is open. The issue holds the person's decisions, and the decisions above follow the code.
