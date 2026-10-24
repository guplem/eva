# Plan: clearer problem notices that the person can close (#541)

## Motivation

A notice from another machine filled a quarter of a phone screen. It had a double period, three sentences that said where to fix it, and no close button. One failed update check on a laptop with no network caused it.

## Changes

1. **Double period.** Add a helper in `problem-rules.ts` that drops a final period of an inner error text. Use it in each message that puts an error text before a period.
2. **Update check grace.** See G2 below.
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

- G1. The hidden mark lives in the core (`AlertCenter`), so it applies to every browser. It stops the 24-hour reminder. `/status`, the tray and the machine report still list a hidden problem. Only the web notice and the reminder respect the mark. Source: "Every problem must reach the phone"; Telegram cannot read a browser's storage.
- G1b. A hidden problem shows again when its level rises (warn to error), or after it clears and starts again. A new text alone does not show it again: a relayed error reason changes between failures, such as a timeout and then a DNS error.
- G1c. After a restart, `report()` checks the hidden mark before the first alert, so a hidden problem sends nothing.
- G2. Count time, not checks. The Settings page checks each time it opens, so three checks can fail in 20 minutes. `Updater` keeps `failingSince`. `updateProblem` returns `"keep"` while the check fails for less than 2 hours, as `vaultSyncProblem` does. `"keep"` and never `null`: `null` would send a false "Updates work again".
- G2b. Shorten the next check to one hour only when `failedStep` is `"check"`. A failed install keeps the frequency, so it does not download every hour.
- G2c. The message names no slash command: on a relayed alert, a command acts on the hub (`engineRestartProblem` avoids it for this reason). With the frequency off, the message does not say "tries again".
- G3. `AlertCenter` does no file I/O. It takes the saved marks and a callback. `Eva` keeps them in `state/hidden-problems.json`, with `writeFileAtomic` and `readJsonTolerant`. Format: `{ "hidden": { "<key>": "<level>" } }`. `dismiss()` forgets the mark too.
- G4. One word: "hide" for the method, the field, the route and the button. `dismiss` already means "forget with no resolved alert". The button is a `ghost` icon button with the `x` icon and `aria-label="Hide this notice"`, last in the notice row.
- Relayed words: "On <machine>: <message> Fix it in Eva on <machine>. Telegram commands act on <hub> only. If <machine> no longer runs Eva, ask the Assistant to delete <file>."
