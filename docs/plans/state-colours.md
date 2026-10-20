# Plan: one colour for each state (issue #208)

## Why

The EVE guide gives `--warn` (amber) to a thing that waits for the person, and `--bad` (red) to a thing that failed. After the redesign, the setup state "missing" uses red. So the Settings home shows a red setup card and red count badges, while the nav badge for the same work is amber. A missing step is work, not an error.

## Audit

Red today, but the state is "waits for the person":

- `.hero.missing`: the "Finish setting up Eva" card.
- `.nav-mark.missing`: the count badge on each Settings section card.
- `.pill.missing`, `.status-icon.missing`, `.step-link.missing`, `.stepper-dot.missing`, `.step-header.missing`.
- The `callout danger` on a step page with a missing step, and on Engines when the claude program is missing.

Red, and correct (a failure or a delete): `.failed` marks, failed tests, failed runs and turns, login and form errors, problem notices with level `error`, `button.danger`, the device log out button, removed diff lines.

Amber, and correct: approvals, the nav badge, offline, warnings, paused and changed projects.

## Gaps and decisions

1. **The web `AGENTS.md` says `--bad` means "the person must act".** This contradicts the issue and the guide. Decision: rewrite the rule. `--warn` means the person must act, or take care. `--bad` means a failure or a delete.
2. **The setup card when all is done.** The issue asks for the neutral card of the reference. Decision: a neutral card in both states. The ring and the headline show the progress.
3. **Text on an amber fill.** `--warn` text on `--warn-bg` is too weak for small text. Decision: use `--warn-ink`, as `.status-pill.needs-you` does.
4. **The count badge.** Decision: the same solid amber with dark ink as the nav badge, through one new token `--on-warn`, so no component rule holds a raw colour.
5. **A failed step** stays red everywhere.

## Steps

1. Add an e2e test: a missing step shows amber on the Settings home and the step pages, and the setup card has no red.
2. Change the CSS and the two callouts.
3. Rewrite the colour rule in `src/frontends/web/AGENTS.md`.
