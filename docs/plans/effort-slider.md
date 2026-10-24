# Pick the chat effort with a slider (#487)

## Motivation

The chip menu of the composer shows six effort buttons. They wrap over two lines on a phone. The levels have an order, so one slider shows them in less space and makes the order clear.

## Change

- In `EngineChip` (`src/frontends/web/client/Composer.tsx`), replace the "Effort" buttons with one `input type="range"`. Each stop is one entry of `effortLevels`.
- Show the name of the level at the right of the slider.
- Keep the group's `role="group"` and its "Effort" name.

## Gaps

1. **When does the chat take the new effort?** React fires `onChange` on each `input` event, so a drag would send one request for each stop.
2. **How does a screen reader read the level?** A range input reads its number by default.
3. **How does the slider look?** No range input has a style in the web front end yet.
4. **How do the e2e tests move the slider?** `test/e2e/web-ui.spec.ts` clicks the effort buttons.

## Decisions

(Filled after the gap search.)
