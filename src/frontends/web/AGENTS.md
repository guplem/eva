# Web front end

## Theme

- Follow the EVE design in `docs/design/eve/README.md`. It owns the colour tokens, the radii, the fonts and the icons.
- Take every colour from the EVE tokens at the top of `styles.css`, such as `--panel`, `--ink`, `--accent` and `--ok`. Write no raw colour in a component rule.
- Take each space and text size from the `--space-*` and `--text-*` scale in `styles.css`.
- Use each state colour for the one meaning that the EVE guide gives it.
- Show a state with a shape or a word too, never with colour alone.
- Use the shared classes before you add one: `card`, `pill`, `callout`, `field`, `field-hint`, `inline-form`, `button-row`, `guide-steps`, `command-line`. Buttons take `primary`, `ghost`, `danger` or `large`.
- Take each icon from `client/icons.tsx`.

## Settings

- Add a setting to its section's file (`*Section.tsx`) as a `Card` with an `item` id. Add the same id to `searchEntries` in `client/settings-routes.ts`, so the search finds it.
- Write a setup step's guide as numbered `guide-steps` in plain words, for a person who never used a terminal. Give each command a `CommandLine`, so the person copies it.

## Captures

- To capture the web page, start `bun run test/e2e/serve-demo.ts`. Then run `scripts/capture-ui.ts`: its header gives the arguments.
