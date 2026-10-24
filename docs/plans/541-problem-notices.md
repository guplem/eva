# Plan: clearer problem notices that the person can close (#541)

## Motivation

A notice from another machine filled a quarter of a phone screen. It had a double period, three sentences that said where to fix it, and no close button. One failed update check on a laptop with no network caused it.

## Changes

1. **Double period.** Add a helper in `problem-rules.ts` that drops a final period of an inner error text. Use it in each message that puts an error text before a period.
2. **Update check grace.** `Updater` counts the failed checks in a row (`failedChecks` in `UpdateStatus`). After a failed check, the next check is due in one hour at most. `updateProblem` raises the check warning only from the third failed check in a row. A failed install alerts at once.
3. **Clearer text.**
   - Update check: "Eva could not check for updates: <reason>. She tries again in an hour. Send /update to try now."
   - Relayed: "<machine>: <message> To fix it, open Eva on <machine>: commands here act on <hub> only. If <machine> no longer runs Eva, ask the Assistant to delete <file>."
   - `ProblemNotices.tsx` drops its extra sentence.
4. **Close a notice.**
   - `AlertCenter.hide(key)` marks an open problem as hidden. It sends no 24-hour reminder for a hidden problem.
   - A report with a new message or level shows the problem again. A resolve forgets the hidden mark.
   - `ProblemDetail` gets `hidden: boolean`. The web app shows no notice for a hidden problem. Other users of `problemDetails`, such as the Claude login check, still see it.
   - A state file on the machine keeps the hidden keys with their messages, so a restart does not show them again.
   - `POST /api/problems/hide` with `{ key }`. The notice gets a close button.

## Gaps

- G1. Where does a closed notice stay closed: one browser, or all front ends? Does it stop the Telegram reminder?
- G2. Which rule stops the alert for a short network failure?
- G3. Where does the hidden state live, and in which format?
- G4. Which words, and which icon and style, for the close button?

## Decisions

(Filled after research.)
