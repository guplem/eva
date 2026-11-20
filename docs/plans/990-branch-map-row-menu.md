# Plan: a context menu on each row of the branch map (#990)

## Goal

A right click, or a long press on a phone, on any row of the branch map opens Eva's menu with the quick actions of that turn and its branch.

## Design

- Move the retry and fork flow of an answer out of `Branch` in `Conversation.tsx` into a hook, `useAnswerActions`. It keeps the undo question (#525) and the clone choice of a Project chat (#523). `Conversation` makes it once, and gives it to the chat and to the branch map.
- Move the rules of Retry and Fork (`canRetry`, `canFork`) into one pure function, `answerActions`, so the answer and the map row use the same rules.
- Give `BranchRow` the menu on every row. Items, in this order:
  - A group with the row label, such as "Main line · answer 3": Show, Copy message, Retry, Fork.
  - A group with the branch name: Rename, Delete fork.
- A row with no turn has only the branch group. The phone's branch sheet has no Retry and Fork: it lives in the header, outside the chat.
- Extend `useForkMenu` with the extra items, so the map and the chat list keep one menu hook.

## Gaps

- **Which actions?** Settled by the answer menu (#863): Copy, Retry, Fork. Show is the click action, for a keyboard and a screen reader. The branch actions stay (#637, #647).
- **Which rows?** Every row, as every answer has its menu.
- **Copy which text?** The person's message: the row shows it.

## Tests

- Unit: `answerActions` and the row items.
- E2E: a right click on a middle row of the map shows Retry, Fork and Copy message, and Fork makes a new branch.
