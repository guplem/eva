/**
 * The math of the send morph (#943): the message box turns into the person's new bubble. `send-morph-player.ts` plays it
 * in the page. Each value here takes the share of the morph's time, from 0 at the send to 1 at the end.
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The four corners of a box, as the browser gives them: top left, top right, bottom right, bottom left. */
export type Corners = readonly [string, string, string, string];

/**
 * How much the spring brakes. Below 1 it passes the end a little and comes back, which reads as a soft landing.
 * At 0.78 it passes by about 2 % and reaches the end at about 40 % of the time.
 */
const damping = 0.78;
/** The spring's speed, chosen so that what is left of the bounce at the end is too small to see. */
const speed = 6.9 / damping;
const dampedSpeed = speed * Math.sqrt(1 - damping * damping);

/** How far the box has gone, at a share of the morph's time. It ends exactly at 1, so the last frame is the bubble. */
export function springAt(time: number): number {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  const decay = Math.exp(-damping * speed * time);
  return 1 - decay * (Math.cos(dampedSpeed * time) + ((damping * speed) / dampedSpeed) * Math.sin(dampedSpeed * time));
}

/**
 * How far the chat has scrolled, at a share of the morph's time. It brakes and never passes the end: a chat that
 * overshoots would show the newest message behind the box for a moment, then pull it back.
 */
export function glideAt(time: number): number {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  return 1 - (1 - time) ** 4;
}

function mix(from: number, to: number, share: number): number {
  return from + (to - from) * share;
}

/** The box at `share` of the way from one place to the other. A spring that passes the end never makes a size negative. */
export function boxAt(from: Box, to: Box, share: number): Box {
  return {
    x: mix(from.x, to.x, share),
    y: mix(from.y, to.y, share),
    width: Math.max(0, mix(from.width, to.width, share)),
    height: Math.max(0, mix(from.height, to.height, share)),
  };
}

function pixels(corner: string): number {
  const value = Number.parseFloat(corner);
  return Number.isFinite(value) ? value : 0;
}

/** The corners at `share` of the way, as a `border-radius` value. The bubble's small corner is its tail. */
export function cornersAt(from: Corners, to: Corners, share: number): string {
  return from.map((corner, index) => `${String(mix(pixels(corner), pixels(to[index] ?? "0"), share))}px`).join(" ");
}

/** A value that goes from 0 to 1 between two moments, and stays put outside them. */
function ramp(time: number, start: number, end: number): number {
  return Math.min(1, Math.max(0, (time - start) / (end - start)));
}

/**
 * The opacity of each layer. The box text leaves before the bubble text comes, so the two blur together only briefly.
 * The box surface stays whole until the bubble covers it, so the chat never shows through the morph.
 */
export function crossFade(time: number): { readonly box: number; readonly boxText: number; readonly bubble: number } {
  return {
    box: 1 - ramp(time, 0.62, 0.8),
    boxText: 1 - ramp(time, 0, 0.42),
    bubble: ramp(time, 0.22, 0.62),
  };
}

/** A `--dur-*` token in milliseconds. The bundler may write `560ms` as `.56s`. Null when the value is not a time. */
export function durationMs(value: string): number | null {
  const found = /^(-?[\d.]+)(ms|s)$/.exec(value.trim());
  if (found === null) return null;
  const amount = Number.parseFloat(found[1] ?? "");
  if (!Number.isFinite(amount)) return null;
  return found[2] === "s" ? amount * 1000 : amount;
}
