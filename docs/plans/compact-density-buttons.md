# Compact density keeps each button's own padding

Issue: #413.

## Why

A person who picks Compact on a narrow phone gets a page that scrolls sideways. Eva must work from a phone, so this is a gap.

## Cause

`:root[data-density="compact"] button { padding: 3px 8px; }` in `src/frontends/web/styles.css` has the specificity (0,2,1). Each button component sets its padding with one class, such as `.nav-button` (0,1,0). So the compact rule wins over every component:

- `.nav-button` gets 8 px on each side. With `.nav-icon` at 58 px, a tab needs 74 px. Five tabs need 370 px plus the bar padding, more than a 360 px screen.
- The "Edit" and "Restore the default" buttons, and the "Try them" buttons, lose the padding of their own rules.

## Plan

1. Add an e2e test: in Compact, at 360 px, the page does not scroll sideways, and buttons of a component keep the padding of that component.
2. Give the base `button` rule its padding from a token, `--button-padding`. Compact changes only the token. A component rule then wins again, because the token only sets the default.
3. Let each tab shrink: `grid-template-columns: repeat(5, minmax(0, 1fr))`, and cap `.nav-icon` at the tab width. A long label or a large font then cannot widen the bar.

## Gaps

- Is there a past decision that Compact must shrink every button, also the component buttons? Answer: none found. The comment says only "smaller text and less space". The token keeps the smaller default.
- Does `.list-item` need the same fix? Answer: not in this issue. No capture shows a problem with it.
