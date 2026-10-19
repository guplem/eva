# Plan: Updates section and version dialog in the EVE style

Issue #178, part of #161. The reference is the "Updates" page of `docs/design/eve/reference.html`.

## Motivation

The dialog shows a select with version numbers and a long summary. The person cannot see at a glance what each version changes, or what the button does. The design gives each version one row with one sentence, and a button that names the action.

## Gaps and decisions

1. **Chips or selects for the policy.** Decision: chips (`ChoiceChips`, as in Personalize) for both "Install updates automatically" (4 choices) and "Eva installs by herself" (3 choices). Both are few.
2. **The policy chips inside the dialog.** The capture shows them. Decision: keep them only in the card. Each setting has one home on the page, and the card stays behind the dialog. Write the gap in the PR.
3. **A date for each version.** The core keeps no date. Decision: read `published_at` from the GitHub release into an optional `publishedAt` of `ReleaseInfo`, and send it as `publishedAt: string | null` in each `NewerRelease`. An added field of a sent shape is not breaking.
4. **One sentence per version.** The summary covers the whole jump, and has many lines. Decision: add `headline` to `NewerRelease`: the first change of that release alone, breaking changes first, without the commit prefix or the PR number. The core computes it, so the web bundle does not import the release code.
5. **The "Installed" row.** The releases list only newer versions. Decision: add one row for the current version, with the "Installed" pill and no date. Each newer row has the "New" pill.
6. **The main button.** Decision: "Update to v<version> and restart". It installs the picked row.
7. **The restart note.** Real behavior: Eva installs only when no chat runs a turn (`Updater`), then the supervisor starts the new copy at once (`restartDecision`, 0 ms). The chats live in `state/sessions.json`, and each continues its engine session. Decision: "Eva installs it when no chat runs, then restarts in a few seconds. Your chats stay as they are."
8. **Faces.** Decision: `stateFaces.news` (surprised) in the card and the dialog when a version waits; `stateFaces.greeting` (happy) in the card after the new Eva answers.
9. **Dialog and sheet.** Decision: a dialog on a computer, a bottom sheet under 760 px, as the schedule dialogs do. The buttons stack at full width on a phone.
10. **The major warning.** Decision: an amber `callout warning` with `role="alert"`, in the dialog when the picked row is major, and in the card for the major policy.

## Steps

1. Core: `publishedAt` and `headline`, with unit tests.
2. Web: the card with chips and faces, the new dialog, CSS, and e2e tests on a computer and a phone.
