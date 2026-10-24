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

No `AGENTS.md` rule settles a gap. The web client has no range input yet. Three searches agreed on each answer.

1. **Commit on the native `change` event.** A local `shown` level follows each React `onChange`, so the name changes during a drag. A native `change` listener on a ref sends one request: on release, or on each key press. `ChatHeader.tsx` listens to a native event in the same way. The slider is not `disabled` while it saves: a disabled element loses the drag and the keyboard focus. `shown` follows `session.effort` again after each save, so a failed save shows the old level.
2. **Set `aria-valuetext` to the level name.** The visible name is `aria-hidden`, so a screen reader does not read it twice.
3. **Style the slider like the progress bar:** a `--chip` track and an `--accent` thumb, with the shared focus ring. The slider takes the free width. The name gets the width of the longest name, so the slider does not move. On a phone, the slider is 44px high, as the composer chips are.
4. **Move the slider with the keyboard in the e2e test.** Keys fire real events. `fill()` sets the value directly, so React can miss the change.
