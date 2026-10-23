/**
 * EVE's gaze: on a computer with a mouse, the eyes of a waiting visor follow the pointer. The
 * math lives here, apart from the browser, so a test can check it.
 */

/** EVE first shows her greeting face, then looks at the pointer. */
export const gazeDelayMs = 5000;

/** The farthest the eyes move, in em of the visor, so they stay inside the face. */
export const maxGaze = { x: 0.1, y: 0.06 } as const;

// At this distance in pixels, the eyes reach half of their range. A far pointer pulls harder
// than a near one, but the eyes slow down as they near the edge of the face.
const halfReachPx = 220;

/** The eyes' offset in em, for a pointer at `dx`, `dy` pixels from the visor's centre. */
export function gazeOffset(dx: number, dy: number): { readonly x: number; readonly y: number } {
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { x: 0, y: 0 };
  const reach = distance / (distance + halfReachPx);
  return { x: (maxGaze.x * reach * dx) / distance, y: (maxGaze.y * reach * dy) / distance };
}

/** A device with a mouse or a trackpad: it hovers, and it points with precision. A phone does not. */
export const pointerQuery = "(hover: hover) and (pointer: fine)";
