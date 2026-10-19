# Web front end

## Theme

- Follow the EVE design in `docs/design/eve/README.md`. It owns the colour tokens, the radii, the fonts and the icons.
- Take every colour from the EVE tokens at the top of `styles.css`, such as `--panel`, `--ink`, `--accent` and `--ok`. Write no raw colour in a component rule.
- Take each space and text size from the `--space-*` and `--text-*` scale in `styles.css`.
- Use the state colours for one meaning each. `--ok` means done. `--bad` means the person must act. `--warn` means wait, or take care. `--chip` means optional.
- Show a state with a shape or a word too, never with colour alone: `StatusIcon` has a check, an alert or a plus, and `StatusPill` has a word.
- Use the shared classes before you add one: `card`, `pill`, `callout`, `field`, `field-hint`, `inline-form`, `button-row`, `guide-steps`, `command-line`. Buttons take `primary`, `ghost`, `danger` or `large`.
- Take an icon from `client/icons.tsx`. Its set is the design's set, and a test keeps it so.

## Settings

- Add a setting to its section's file (`*Section.tsx`) as a `Card` with an `item` id. Add the same id to `searchEntries` in `client/settings-routes.ts`, so the search finds it.
- Write a setup step's guide as numbered `guide-steps` in plain words, for a person who never used a terminal. Give each command a `CommandLine`, so the person copies it.
- On a phone, every button is 44 px tall or more, and no page is wider than the screen. The phone tests in `test/e2e/web-ui.spec.ts` check each Settings page.

## Before and after captures

- Capture the page for a PR with `scripts/capture-ui.ts`. Start `bun run test/e2e/serve-demo.ts` in the checkout to capture, then run the script. Its header gives the arguments.
- Run the script from the PR checkout for both sides. It only talks to the demo port, so it captures the demo that runs: the `origin/main` worktree for "before", the PR branch for "after".
