# Plan: the Eva updates card shows the install progress only once

Issue: #404.

## Motivation

- While Eva installs an update, the Eva updates card shows the version and the download share twice: in the status callout and in the `ProgressBar`.
- The Claude Code card in the same file shows a progress bar while its update runs, and the status callout only when nothing runs.
- The web `AGENTS.md` says: solve the same problem with the same pattern on every page.

## Change

- Add `updateCallout(update, wait)` to `src/frontends/web/client/update-words.ts`. It returns the callout text, or null while the card shows a wait.
- Show the callout in `UpdatesSection.tsx` only when `updateCallout` returns text.
- Keep `describeUpdate` as it is. The CLI and Telegram have no progress bar, so they keep the "installing (65% downloaded)" line.

## Gaps

1. **Which waits hide the callout?** The card shows a wait during the download, during a check, and while it waits for the new Eva to restart.
2. **Does an error hide too?** A failed install sets `lastError`, and the phase leaves `updating`.

## Decisions

1. **Every wait hides the callout.** This is the pattern of the Claude Code card. The download and the check lose nothing: the callout only repeats the bar, or shows the result of the last check. The restart wait loses the version, so its bar label names the version: "Eva restarts with 2.34.0 when no chat runs…".
2. **An error never hides.** `check()` clears `lastError` only on success, and `install()` keeps it while the phase is `updating` (`src/core/updates/updater.ts`). So `updateCallout` returns the text whenever `lastError` is set.
3. **A null status during a wait shows nothing.** After a restart, `waitForNewEva` can set a null status for one render. "This Eva cannot update herself." would flash, so the callout stays hidden.
