# Web front end

## Theme

- Follow the EVE design in `docs/design/eve/README.md`. It owns the colour tokens, the radii, the fonts and the icons.
- Take every colour from the EVE tokens at the top of `styles.css`, such as `--panel`, `--ink`, `--accent` and `--ok`. Write no raw colour in a component rule.
- Take each space and text size from the `--space-*` and `--text-*` scale in `styles.css`.
- Take each duration and curve from the `--dur-*` and `--ease-*` tokens in `styles.css`.
- Animate only to give feedback, to show where a thing comes from, or to bridge a change. Never animate an action that a person repeats many times a day.
- Use each state colour for the one meaning that the EVE guide gives it.
- Show a state with a shape or a word too, never with colour alone.
- Use the shared classes before you add one: `card`, `pill`, `callout`, `field`, `field-hint`, `inline-form`, `button-row`, `guide-steps`, `command-line`. Buttons take `primary`, `ghost`, `danger` or `large`.
- A box that scrolls cuts the shadows of its cards at its padding. Give it room for `--shadow`: the Files page shows how. `test/e2e/shadows.spec.ts` finds a cut shadow, so add each new page with cards to it.
- Take each icon from `client/icons.tsx`.
- Turn off a control with `aria-disabled`, not `disabled`, when a press must tell the person that the action cannot run. A press on it then plays the problem sound and vibration.
- Show each wait with a shared component of `client/Loading.tsx`, never with a sentence alone, such as "Loading…".
  - Inside a card, show `ProgressBar`. Give it the share of the work when Eva knows it, so it fills and shows the percentage. With no share, two lines of light move across it again and again.
  - For content that fills a large area, such as a chat or a list, show a skeleton with the shape of that content.
  - A button label such as "Testing…" is not enough. While the button waits, put a `ButtonSpinner` before its label, give the button `aria-busy`, and show a `ProgressBar` below it. Give both the same share.

## Settings

- Add a setting to its section's file (`*Section.tsx`) as a `Card` with an `item` id. Add the same id to `searchEntries` in `client/settings-routes.ts`, so the search finds it.
- Write a setup step's guide as numbered `guide-steps` in plain words, for a person who never used a terminal. Give each command a `CommandLine`, so the person copies it.

## Captures

- To capture the web app, start `bun run test/e2e/serve-demo.ts`. Then run `scripts/capture-ui.ts`: its header gives the arguments.
- When a change alters how a page of the EVE guide looks, update its captures in the same PR. `docs/design/eve/README.md` says when and how.
- In Git Bash, set `MSYS_NO_PATHCONV=1` for the capture command. Otherwise Git Bash turns `#/files` into a Windows path, and the captures show the wrong page.
