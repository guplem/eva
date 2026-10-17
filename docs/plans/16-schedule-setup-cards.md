# Plan: a schedule's setup card reaches the person before the schedule runs

Issue: #16. Lessons 66 and 67.

## Goal

A new or changed schedule shows a setup card before it first fires. Today the scheduler marks the card as shown even when no front end showed it. This plan makes the card a real check.

## Steps

1. **Scheduler: count only a shown card.** A schedule listener returns `true` when it showed the event to the person. The scheduler marks a card as announced only when at least one listener returns `true`. Until then the schedule does not fire, and each check sends the card again.
2. **Scheduler: report a waiting card.** The scheduler reports each waiting card through a new option. Eva turns it into an open alert problem. `eva status`, Telegram `/status` and the web problem banner show open problems, so they say why the schedule waits. The problem clears when the card is shown or the schedule is removed.
3. **Telegram: say when it showed a card.** The bot returns `true` only when a paired chat got the card.
4. **Local API: send schedule events over the WebSocket.** Each socket also subscribes to the scheduler. It returns `true` for a card it sent.
5. **Web UI: show the cards.** The app shows each card that arrives, with a button to close it.
6. **Docs.** Update the user guide where it describes setup cards.

## Gaps

- G1. What counts as "a front end that can show a card" for the web UI?
- G2. How does `eva status` say why: an alert problem, or a new status field?
- G3. Where and how does the web UI show a card, and does a card survive a reload?
- G4. A Telegram send that fails: shown or not?
- G5. Does the "skip a slot that is due in the same check as the card" rule still hold when the card waits?

## Decisions

To be filled after the gap review.
