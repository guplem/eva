/**
 * Where a context menu goes. `Menu.tsx` opens it at the pointer, at the place that this file gives.
 */
import type { Size } from "./tooltip-place.ts";

/** The smallest space between a menu and the edge of the screen, in pixels. */
export const menuMargin = 8;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface MenuPlace {
  readonly left: number;
  readonly top: number;
}

/**
 * Below and to the right of the pointer, as a computer's own menu opens. A menu that does not fit
 * there opens on the other side of the pointer. It always stays inside the screen.
 */
export function placeMenu(point: Point, menu: Size, viewport: Size): MenuPlace {
  return {
    left: side(point.x, menu.width, viewport.width),
    top: side(point.y, menu.height, viewport.height),
  };
}

function side(at: number, length: number, screen: number): number {
  const last = screen - menuMargin - length;
  const start = at <= last ? at : at - length;
  // A menu larger than the screen starts at the margin, so its first item stays in view.
  return Math.max(menuMargin, Math.min(start, last));
}
