/**
 * The rules of a drag on a bottom sheet, as on a native phone sheet: the sheet follows the finger
 * down, stretches a little up, and closes after a long drag or a fast flick down.
 * `sheet-drag-watch.ts` applies them to the page.
 */

/** The top of a sheet, with its grab handle, where a drag starts in both directions. */
export const handleZonePx = 40;

/** How far a drag up can stretch a sheet that already shows all of its content. */
const stretchLimitPx = 24;
/** A move shorter than this shows no direction yet, so a tap stays a tap. */
const directionPx = 6;
/** A flick faster than this, in pixels per millisecond, closes the sheet. */
const flickSpeed = 0.5;
/** A flick shorter than this is a shaky tap, not a flick. */
const flickMinimumPx = 16;
/** The time of the last moves that give the speed of a flick. */
const speedWindowMs = 100;

/** The move of the sheet for a move of the finger: down at once, up with resistance. */
export function sheetOffset(distance: number): number {
  if (distance >= 0) return distance;
  return -stretchLimitPx * (1 - Math.exp(distance / (stretchLimitPx * 3)));
}

/** What the sheet does when the finger lets go. */
export function releaseOf(drag: {
  readonly distance: number;
  readonly velocity: number;
  readonly height: number;
}): "close" | "stay" {
  // A quarter of the sheet, but never more than a comfortable reach of a thumb on a tall sheet.
  const closeAt = Math.min(drag.height / 4, 160);
  if (drag.distance >= closeAt) return "close";
  if (drag.distance >= flickMinimumPx && drag.velocity >= flickSpeed) return "close";
  return "stay";
}

/**
 * Whether a move of the finger drags the sheet. The handle area drags in both directions. The
 * content drags only down, and only when it is scrolled to the top, so it still scrolls.
 */
export function dragStart(move: {
  readonly dx: number;
  readonly dy: number;
  readonly fromHandle: boolean;
  readonly atTop: boolean;
}): "wait" | "drag" | "skip" {
  const { dx, dy } = move;
  if (Math.abs(dx) < directionPx && Math.abs(dy) < directionPx) return "wait";
  if (Math.abs(dx) >= Math.abs(dy)) return "skip";
  if (move.fromHandle) return "drag";
  return dy > 0 && move.atTop ? "drag" : "skip";
}

/** One drag: its distance, and the speed of its last moves. */
export class SheetDrag {
  private readonly startY: number;
  private readonly samples: { y: number; at: number }[];

  constructor(y: number, at: number) {
    this.startY = y;
    this.samples = [{ y, at }];
  }

  move(y: number, at: number): void {
    this.samples.push({ y, at });
    while (this.samples.length > 2 && (this.samples[1]?.at ?? at) < at - speedWindowMs) this.samples.shift();
  }

  get distance(): number {
    return this.last.y - this.startY;
  }

  get velocity(): number {
    const last = this.last;
    const first = this.samples.find((sample) => sample.at >= last.at - speedWindowMs);
    if (first === undefined || first === last || last.at === first.at) return 0;
    return (last.y - first.y) / (last.at - first.at);
  }

  /** The speed at a release: a finger that held still before it let go has none. */
  speedAt(at: number): number {
    return at - this.last.at > speedWindowMs ? 0 : this.velocity;
  }

  private get last(): { y: number; at: number } {
    return this.samples[this.samples.length - 1] ?? { y: this.startY, at: 0 };
  }
}
