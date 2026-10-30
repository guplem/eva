/**
 * The tallest height of the text in a message box (issue 660). A person drags the handle on top of the box to read
 * more of the chat or more of their own message. Each browser keeps its own height in `localStorage`, as with the
 * chat panel: a phone and a computer need different heights.
 */

/** The shares of the window height that the text can take. The box never hides the whole chat. */
export const composerHeightRange = { min: 0.1, max: 0.8 } as const;

const storageKey = "eva.composer-height";

function clampShare(share: number): number {
  return Math.min(composerHeightRange.max, Math.max(composerHeightRange.min, share));
}

/** A height in pixels as a share of the window, so a turned phone keeps the same split. */
export function heightShare(height: number, windowHeight: number): number {
  return clampShare(height / windowHeight);
}

/** A stored share that a person or a later version broke gives the usual height. */
export function keptHeightShare(stored: string | null): number | null {
  if (stored === null) return null;
  const share = Number(stored);
  return Number.isFinite(share) && share > 0 ? clampShare(share) : null;
}

/** A private window or blocked storage throws: the box then has the usual height. */
export function readComposerHeight(): number | null {
  try {
    return keptHeightShare(localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

/** Null forgets the height, so the box takes the usual height again. */
export function saveComposerHeight(share: number | null): void {
  try {
    if (share === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, String(share));
  } catch {
    // The height still applies until the page reloads.
  }
}
