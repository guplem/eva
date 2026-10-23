# Plan: show how the person's rules differ from the default

Issue: #472.

## Motivation

The "Eva's rules" card shows the person's rules and offers "Restore the default". The person cannot see what they changed from the default, so they cannot tell what a restore removes. Eva works from a phone, so the view must fit a phone.

## Approach

- The API already sends `defaultText` in `AssistantRulesView`. The change needs only the web client.
- Extend `src/frontends/web/client/line-diff.ts` with a one-list ("unified") diff: rows of kind `same`, `added`, `removed` and `gap`. Reuse its longest-common-subsequence code and its folding of long unchanged runs.
- Render the rows with the existing `.diff` style. Add `added` and `removed` row classes with `--ok-bg` and `--bad-bg`, and a `+` or `-` mark, so colour is not the only signal.
- Add a section to `AssistantRulesCard.tsx` that shows the diff.

## Gaps

1. **Where the diff shows.** A `<details>` frame, closed by default, like the built-in rules? Or a button that swaps the formatted rules for the diff?
2. **Direction and words.** Default to the person's rules: a line only in the person's rules is "added". What does the section say when the two texts are equal, or when the person has no rules?
3. **Shared rendering.** Extract a shared diff component for `NoteConflicts.tsx` and the rules card, or render the rows in each place?

## Decisions

Filled in after the gap research.
