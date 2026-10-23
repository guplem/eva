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

1. **A closed `<details>` frame,** like the built-in rules and `PermissionsCard`. It sits above the buttons, so it is next to "Restore the default". It shows only when the person does not edit, because it compares the saved text. It gets its own class, `rules-diff`: the e2e test finds the built-in rules with `details.rules-box`, which must stay one element.
2. **Default to the person's rules.** A hint says what `+` and `-` mean. When the rules have no line that differs, the frame says that the rules are the same as the default. When the person has no rules, the frame does not show: the card already says so, and a diff of only red lines helps nobody. The equal check uses the diff rows, so CRLF and a byte order mark do not count.
3. **One shared component,** `DiffLines.tsx`, renders the rows of both views (`AGENTS.md`: reuse a shared component). The note conflict view keeps its look. The `+` and `-` marks are `aria-hidden`, and a visually hidden word says "Added" or "Removed" for a screen reader. The diff runs in `useMemo`, because the page renders often while a chat streams.
4. **Colours** come from the EVE guide's Diff row: added lines on `--ok-bg`, removed lines on `--bad-bg`.
