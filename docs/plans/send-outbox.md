# Plan: a message sent on a bad connection stays in the chat and goes again (#945)

## Goal

- A sent message stays in the chat with its state, and the page sends it again until it arrives.
- Eva never runs the same message twice.

## Decisions

- The core drops a repeated client id. `SessionManager` keeps the last client ids of each chat in memory. A repeat answers the promise of the first send and starts nothing. A restart forgets them, as it forgets the queued messages.
- A pure module, `client/outbox.ts`, holds the outbox: one queue for each chat, in order. It knows each message's state (`sending`, `waiting`, `failed`), its tries and its next wait. It takes its clock, its timer and its send as arguments, so unit tests cover it with fakes.
- The outbox is one object for the whole page, so a message stays when the person changes chat.
- A try that fails with a network error, a time limit or a 5xx answer waits, then goes again: about 2, 5, 15, 30 and 60 seconds. After the last try, the message is `failed`. A 4xx answer makes it `failed` at once, with the answer's reason.
- The page tries at once on the `online` event, when the page shows again, and when the event stream connects again.
- A turn start whose `clientIds` hold a message's id confirms that message.
- `Conversation.tsx` reads the outbox instead of its own `sent` list. A message that is not confirmed keeps its place below the stored turns. A confirmed message then follows the current rules of `keptPending` and `notInTurn`.
- `onSend` resolves to true once the outbox holds the message. So `Composer.tsx` does not change, and PR #944 does not conflict.
- `UserMessage` gets an optional state line: an icon and a word, and the buttons Try again and Edit when the message failed.
- Edit removes the message from the outbox and puts its text in the chat's box with `unsentTexts.restore`.
- The New chat page keeps its flow until the chat exists. Then it hands the message to the outbox and opens the chat.

## Gaps

None left.
