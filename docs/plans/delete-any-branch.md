# Delete any branch of a chat (#647)

## Goal

The main line is one more branch. "Delete fork" works on every branch, and the forks of a deleted branch stay.

## Design

`SessionManager.deleteBranch(id)` deletes one branch. `delete(id)` still deletes a chat with every branch ("Delete chat", Telegram, clone delete).

With no fork, `deleteBranch` is `delete`. Otherwise:

1. The heir is the oldest fork that shares history with the branch (a fork point that is not null). With none, the heir is the oldest fork.
2. The heir takes the place of the branch: its `parentId`, its `forkAtMessageId` and, for the first branch, the chat fields (title, archive state, Telegram topic, source, `reportsTo`, `continuedFrom`, `forkedFrom`, `seenTurns` of the shared part).
3. The heir gets the turns of the branch up to its fork point, before its own turns.
4. Each other fork of the branch hangs from the heir:
   - A fork at a turn that the heir took keeps its fork point.
   - Forks at later turns form a chain in the order of their fork points. Each one takes the turns after the fork point before it, up to its own, and forks from the branch before it. So no two branches hold the same moved turn.
   - A fork from the start stays a fork from the start.
5. References to the deleted branch (`reportsTo`, `continuedFrom`, `forkedFrom.sessionId`) move to the heir.
6. The `session_deleted` event names the heir (`heirId`), so Telegram moves the topic and the web app opens the heir.

A moved turn keeps where it ran, in a new optional turn field `ranIn: { sessionId, turnIndex, engineSessionId }`:

- Vault snapshot refs are named by session id and turn index. A moved turn keeps the ref names of where it ran. The heir's own turns also move to a new index, so they get `ranIn` too, with `engineSessionId: null` (the branch's own engine session).
- A fork or a retry at a moved turn uses the engine session of `ranIn`.
- A fork that did not run a turn yet forks from its last moved turn.
- The vault keeps the refs that a moved turn still names. A later delete names the gone branches whose refs its dropped turns kept (`snapshotsOf` on `session_deleted`), so the vault deletes them then.
- A running Project work reads `reportsTo` again at its end, so it reports to the heir.

Step details move to the heir's file. Project-mode snapshot ids move with the turns, so only the dropped turns forget theirs.

## Decisions

- Copy the history at the delete, not at each fork: no migration, and the stored format only gains optional fields.
- The heir keeps its own id, so no id gets new turns after a delete, and no vault ref name is used twice.
- Refuse the delete while a turn runs in the branch or in one of its forks.
- The first branch can take a name. With no name, it shows as "Main line".
- A device that missed the `session_deleted` event does not know the heir. After a reload, an old address of the deleted branch opens another chat, as for any deleted chat.
