# Web front end

## Theme

- Take every color, space, radius, font size and shadow from the tokens at the top of `styles.css`. Write no raw color or pixel size in a component rule.
- Give each new color token a value in all three theme blocks: `:root`, the dark `@media` block and `:root[data-theme="dark"]`. Keep the two dark blocks equal.
- Use the state colors for one meaning each. Green (`--color-success`) means done. Red (`--color-danger`) means the person must act. Amber (`--color-warning`) means wait, or take care. Grey (`--color-neutral-soft`) means optional.
- Show a state with a shape or a word too, never with color alone: `StatusIcon` has a check, a "!" or a dash, and `StatusPill` has a word.
- Use the shared classes before you add one: `card`, `pill`, `callout`, `field`, `field-hint`, `inline-form`, `button-row`, `guide-steps`, `command-line`. Buttons take `primary`, `ghost`, `danger` or `large`.
- Draw an icon in `client/icons.tsx`, on its 24 px grid. Never load an icon font or an outside image.

## Settings

- Add a setting to its section's file (`*Section.tsx`) as a `Card` with an `item` id. Add the same id to `searchEntries` in `client/settings-routes.ts`, so the search finds it.
- Write a setup step's guide as numbered `guide-steps` in plain words, for a person who never used a terminal. Give each command a `CommandLine`, so the person copies it.
- On a phone, every button is 44 px tall or more, and no page is wider than the screen. The phone tests in `test/e2e/web-ui.spec.ts` check each Settings page.
