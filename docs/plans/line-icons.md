# Line icons on the web page (#164)

## Why

Emoji look different on each system, and they do not follow the theme colours.
The EVE design (#161) uses one set of line icons.
This is a foundation for the nav rail (#167) and the pages that follow.

## What

- Add `src/frontends/web/client/icons.tsx`: an `Icon` component with inline SVG.
  It uses a 24 px grid, a 1.8 px stroke, round caps and joins, and `currentColor`.
- Copy the icon paths from `const P` in the design reference.
- Replace each emoji and Unicode mark on the web page:
  - `☰` (menu button) becomes `menu`.
  - `⏰` (schedules button, schedule chats, the hint) becomes `clock`.
  - `✏️` (rename) becomes `pen`.
  - `✕` (toast and settings notice) becomes `x`.
  - `✓ ✗ ○` (setup steps and test results) become `check`, `alert`, `plus` and `x`.
- Keep every `aria-label`.

## Gaps and decisions

1. **Icon names.** The issue says `wifi-off` and `calendar`. The reference says `wifioff` and `cal`. Decision: use the issue names, because they are clearer.
2. **Reference icons that the issue does not list** (`wifi`, `batt`, `play`). `wifi` and `batt` only draw the fake phone status bar of the mock-up. Decision: leave them out. A later page can add one in one line.
3. **How to draw the paths.** Decision: write each icon as JSX elements, not as an HTML string. This needs no `dangerouslySetInnerHTML` and no dependency.
4. **Size.** The reference draws each icon at 18 px (`.eve svg`). Decision: 18 px by default, from one small `.icon` rule. Pages restyle sizes in their own issues.
5. **Setup step marks.** The reference shows a done step with `check` and a step to do with `alert`. It shows an optional step with the icon of its topic. Eva has no topic icon per step yet (#176). Decision: done is `check`, missing is `alert`, optional is `plus`, to match the reference's "Add" button.
6. **Test results.** `✓` and `✗` become `check` and `x`, with the names "Passed" and "Failed" for a screen reader.
7. **Text that names a mark** ("A step marked ○ is optional", "the Schedules page (⏰)"). Decision: show the icon in the text with a name, so a screen reader reads the sentence whole.
8. **A decorative icon** next to a word that says the same thing (the clock before a schedule chat) is hidden from a screen reader.

## Tests

- A unit test renders each icon of the issue and checks the SVG attributes and the name.
- An end-to-end test opens each main page and finds no emoji or symbol mark in the text.
- The end-to-end tests that read `✓` and `✗` read the icon names.
