# Plan: timeline polish (#893)

## Goal

A clean fade at the left edge of the Projects timeline, a readable In use pill, centred soft dots for Closed, and a tooltip with the dates of each row. On a phone, a long press shows any tooltip.

## Steps

1. `client/long-press.ts`: the timing of a long press (500 ms, 10 px, 400 ms after the lift) and a small `LongPress` class with a timer seam. `Menu.tsx` takes the timing from it.
2. `client/Tooltip.tsx`: a touch that rests on an element with `data-tooltip` shows its tooltip, unless the element has a context menu. The click of that press is dropped. A tooltip of several lines shows its first line in bold. `data-tooltip-target` names the part that the tooltip points at.
3. `client/projects-home.ts`: `TimelineRow` gets the creation day and the closing day. `rowTooltip()` gives the words of the tooltip.
4. `projects-home.css` and `ProjectStats.tsx`: the lane fade, the pill, the centred soft dots, the row hover, and the tooltip on each row.
5. Docs: `docs/guide/reference.md` and `docs/design/eve/README.md`.

## Gaps

None open. The person decided the look in a mockup. The issue lists the assumptions.
