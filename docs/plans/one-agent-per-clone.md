# Plan: one agent per clone (issue 356)

## Motivation

Two agents can edit one clone at once: an idle Project chat and new project work. Their git hooks then pull, commit and push against each other. The person loses work or gets a broken branch, often from a phone, with no terminal to repair it.

## Changes

1. **Grace period.** `freeOrNewClone` (`src/core/projects/project-work.ts`) skips a clone when a chat in it had activity in the last 10 minutes. One named constant holds the 10 minutes.
   - `SessionManager` keeps the time of the last message and the last turn start of each chat, in memory.
   - The record gives the rest after a restart: `createdAt` and `lastTurnAt` (the turn end).
2. **One turn per folder.** `SessionManager.runTurn` takes a lock on the start folder of a Project chat before the turn prepares.
   - While another chat holds the lock, the turn sends a `notice` event, and waits.
   - A stop of the waiting chat ends the wait, and the turn fails with a clear reason.
   - The turn time-out starts after the wait.
   - The lock is per folder, so a wait never blocks another folder.

## Gaps and decisions

- **Does the lock cover Assistant chats?** No. Every Assistant chat runs at the vault root, and Eva's own vault sync handles parallel Assistant turns. A lock there would make all Assistant chats wait for each other. The issue is about clones.
- **Does the creation of a chat count as activity?** Yes. A person opens a new Project chat, and then types. Project work must not take that clone in between.
- **Does the grace period also cover a new Project chat of the person?** Yes. The same `freeOrNewClone` picks the clone, and the same collision can happen.
- **Does the wait count toward the turn time-out?** No. The other turn can run up to the time-out itself, so the waiting turn would always fail.
- **Is a new event kind needed?** No. The existing `notice` event shows the wait in every front end, and adds no stored name.
