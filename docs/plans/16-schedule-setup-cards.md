# Plan: a schedule's setup card reaches the person before the schedule runs

Issue: #16. Lessons 66 and 67.

## Goal

A new or changed schedule shows a setup card before it first fires. Today the scheduler marks the card as shown even when no front end showed it. This plan makes the card a real check.

## Decisions

- **G1. The web UI counts a card as shown only when the person taps "Got it".** An open socket is weak proof: a sleeping phone keeps a dead socket, and Bun drops a message to a slow socket. The web UI follows the approvals pattern instead: the core holds the waiting cards, and the page reads them.
- **G2. An alert problem says why.** `eva status`, Telegram `/status` and the web banner all show `status().problems`. The key is `schedule_card:<id>`, apart from `schedule:<id>`, because a good firing clears that key.
- **G3. A dialog, like the approval dialog.** It shows the fields, the changed fields, the next run, a "Got it" button and a "Remove" button. The page reads `GET /api/schedule-cards` at start, on each reconnect and with the problem poll. The socket also pushes each card, so it shows at once. A card survives a reload, because the core holds it.
- **G4. A failed Telegram send is not shown.** `send` returns null on a failure, so the bot returns `false`, and the next check sends the card again. An unpaired bot returns `false`.
- **G5. The skip rule moves to the moment the card is shown.** While a card waits, the scheduler writes no state. When a front end shows the card, the scheduler records it and marks the slot that is due at that moment as fired.
- **The "Got it" names the fields that the person saw.** The core accepts it only when they match the waiting card, so a change pushed meanwhile gets its own card.
- **The waiting problem clears** when the card is shown, the schedule is removed (by Eva or by hand), or this machine stops being the hub.
- **Old state stays.** A card marked as announced by the old code stays announced. Resetting it would show every card again on each machine.
- **Only the hub holds waiting cards.** A web UI on another machine shows none. Its status shows none either, as today for every schedule problem.

## Steps

1. **Scheduler.** A listener returns `true` when it showed the event to the person. The scheduler records a card only then. It holds each waiting card, lists them, and records a card that a front end confirms. It reports each waiting card through a new `reportCard` option.
2. **Eva.** Turn `reportCard` into the `schedule_card:<id>` alert problem (`scheduleCardProblem` in `problem-rules.ts`).
3. **Telegram.** Return `true` only when the paired chat got the card.
4. **Local API.** Add `GET /api/schedule-cards` and `POST /api/schedule-cards/<id>` with the seen fields. Push `schedule_card` events over the socket.
5. **Web UI.** Show the waiting cards in a dialog with "Got it" and "Remove".
6. **Docs.** Update `docs/guide/reference.md` and the `schedule` skill: the web app shows cards too, and a schedule waits until someone sees its card.
7. **Clean up.** Delete this plan file before the merge. The PR description keeps it.
