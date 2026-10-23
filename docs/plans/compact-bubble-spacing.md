# Even space in compact chat bubbles

Issue: #477.

## Motivation

Eva works from a phone, and compact density exists for the phone. In compact density, the text of a chat bubble nearly touches its top and bottom border, but the sides keep 16 px. The action row under an answer also starts to the right of the text. The bubble looks uneven.

## Cause

- `styles.css` sets only `padding-top` and `padding-bottom` of `.message` to 4 px in compact density.
- `button.ghost` has 12 px of inner space on its sides, so the icons of `.answer-actions` start 12 px right of the text.

## Gaps and decisions

1. **The compact padding of a bubble.** Decision: one token, `--bubble-padding`. Comfortable keeps `13px 16px`. Compact uses `var(--space-2) var(--space-4)` (8 px and 12 px). The line height adds about 3 px above and below the text, so the text gets about 11 px on each edge. Evidence: the web `AGENTS.md` asks for the `--space-*` scale, and `--button-padding` already is a token that compact density changes.
2. **The action row.** Decision: pull `.answer-actions` left by the ghost button's side space, so its first icon lines up with the text. Evidence: `.whole-answer` already does the same with `margin-left: -12px`.
3. **The chat list items.** Decision: leave them. They have no border unless current, and the issue is about bubbles.

## Test

A unit test reads `styles.css` and `conversation.css`, as `settings-layout.test.ts` does. It checks that compact density changes the bubble padding on all four sides, through the token, and that the action row lines up with the text.
