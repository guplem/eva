/**
 * Where a tooltip goes. The browser's own `title` tooltip ignores the theme, so the page draws
 * its own: `Tooltip.tsx` shows the text of `data-tooltip`, at the place that this file gives.
 */

/** The space between the element and its tooltip, in pixels. */
export const tooltipGap = 8;
/** The smallest space between a tooltip and the edge of the screen, in pixels. */
export const tooltipMargin = 8;

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** "right" is for a column of buttons, such as the nav rail, where a tooltip above would cover the next button. */
export type TooltipSide = "above" | "below" | "right";

export interface TooltipPlace {
  readonly left: number;
  readonly top: number;
  readonly side: TooltipSide;
}

/** At the side that the element asks for when it fits. Else above, else below. Always inside the screen. */
export function placeTooltip(
  anchor: Box,
  tip: Size,
  viewport: Size,
  prefer: "above" | "right" = "above",
): TooltipPlace {
  const right = anchor.left + anchor.width + tooltipGap;
  if (prefer === "right" && right + tip.width <= viewport.width - tooltipMargin) {
    const middle = anchor.top + anchor.height / 2 - tip.height / 2;
    return { left: right, top: clamp(middle, viewport.height - tooltipMargin - tip.height), side: "right" };
  }
  const above = anchor.top - tooltipGap - tip.height;
  const side = above >= tooltipMargin ? "above" : "below";
  const top = side === "above" ? above : anchor.top + anchor.height + tooltipGap;
  const centred = anchor.left + anchor.width / 2 - tip.width / 2;
  return { left: clamp(centred, viewport.width - tooltipMargin - tip.width), top, side };
}

/** A tooltip larger than the screen starts at the margin, so its start stays readable. */
function clamp(start: number, last: number): number {
  return Math.max(tooltipMargin, Math.min(start, last));
}
