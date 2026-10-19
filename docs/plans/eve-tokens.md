# Plan: EVE colour tokens, fonts and a seed colour picker

Issue #163, part of #161. The design is `docs/design/eve/README.md` and `reference.html` (pull request #162).

## Motivation

The owner chose the EVE style for the web page. Every later sub-issue restyles a page with the same tokens, fonts and seed colour. This issue lays those foundations, so the other pages only need to use them.

## Work

1. Seed conversion in `client/appearance.ts`: `hexToOklch` from the reference, the clamps (`--c` at most 0.2, `--l` from 0.45 to 0.9, `--on-l`), and an `oklch` to sRGB hex conversion for the `theme-color` meta tags.
2. Store the seed per browser in `localStorage["eva.appearance"]`, with the theme and the density. Apply it as `--h`, `--c`, `--l` and `--on-l` on `<html>` before the first render.
3. `styles.css`: the full token set for light and dark, the radii, the shadows, the glow, the scrim and the main area gradient as variables.
4. Fonts: Quicksand and IBM Plex Mono, bundled with the web client.
5. Settings > Appearance: the 15 seeds and a free colour input.
6. The `theme-color` meta tags follow `--bg`.

## Gaps and decisions

1. **Old variable names.** `styles.css` uses `--background`, `--surface`, `--text` and others. Decision: rename every use to the guide's token (`--bg`, `--panel`, `--ink`, `--muted`, `--line`, `--chip`, `--on-accent`, `--bad`, `--ok`). One name per concept, and the later sub-issues read the guide's names directly. Raw colours (the dialog backdrop, the yellow light, shadows) move to `--scrim`, `--warn` and `--shadow`.
2. **Where the tokens live.** Decision: at the top of `styles.css`, on `:root`, so #164, #165 and every page can use them. The default seed numbers sit in `:root` too, so the page has the EVE blue colours before the script runs.
3. **Fonts.** The reference loads Google Fonts, but the executable must work offline. Decision: add the Fontsource packages `@fontsource-variable/quicksand` (one variable file covers 500 to 700) and `@fontsource/ibm-plex-mono` (400 and 500), and import their CSS from `styles.css`. Bun's HTML bundler copies the font files into the bundle, and `--compile` embeds them. Both fonts use the SIL Open Font License, which allows this.
4. **Theme and density controls.** The reference shows chips. The end-to-end tests select them by label as `<select>`. Decision: keep the two `<select>` fields here. The Settings sub-issue (#176) restyles the section.
5. **Seed picker markup.** Decision: a group named "Colour" with one round button per seed. Each button has the seed name as its label and `aria-pressed`, as in the reference toolbar. A native colour input labelled "Any colour" follows. The name of the current colour shows beside it.
6. **A stored seed that is not a colour.** Decision: accept only `#rrggbb`. Any other value falls back to EVE blue.
7. **`theme-color` value.** Some browsers do not read `oklch()` in this tag. Decision: convert `--bg` for the current seed to a hex colour, for light and for dark, and write it into both meta tags. `index.html` holds the EVE blue values as defaults.
8. **Body text size.** The guide sets 14 px body text. Decision: 14 px for the comfortable density, and 13 px for the compact one. Fields keep 16 px on a touch screen, because a phone browser zooms into a smaller field.
9. **Radii and base elements.** Decision: define every radius of the guide as a variable. Buttons become pills, fields use the input radius, and each old `--radius` use takes the radius of its component (card, bubble, dialog). The full restyle of each page stays with its sub-issue.
10. **Web app manifest.** Its colours are static, and a manifest cannot follow a per-browser seed. Decision: set them to the EVE blue defaults.
