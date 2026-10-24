# Plan: a compact "Search inside files" chip

Issue: #479.

## Motivation

The option is a plain browser checkbox on its own row. On a phone it takes a full line and pushes the list down. It also ignores the EVE theme.

## Decisions

- **Shape.** Put a chip at the right end of the search pill. The person sees the field and its option as one control.
- **Component.** Reuse the `choice-chip` look: a soft tint, an outline and a tick when the chip is on. Do not add a new look.
- **Semantics.** Use a `<button>` with `aria-pressed`, as `ChoiceChips` does. Its name is "Search inside files". Its visible text is "Inside files", so the name holds the visible text (WCAG "label in name").
- **Markup.** The pill becomes a `div`. A `label` inside it holds the icon and the input, so a click on the icon still focuses the input. A button never sits inside a `label`.
- **Empty result text.** Keep the words "Try a search inside files.", so the hint names the chip.

## Gaps

None open. The `AGENTS.md` of the web front end answers each one: reuse the shared classes, take every colour from the EVE tokens, and show a state with a shape or a word too.
