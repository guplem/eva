/**
 * The chats whose offer of a new chat from a summary the person put off (issue 969). Each browser
 * keeps its own choice, as with the chat panel and the height of the message box.
 *
 * The choice is the share of the context window at which the person said "Not now". The offer comes
 * back once the chat grew by `offerAgainStep` points. So one "Not now" never silences a chat that
 * later fills up.
 */

const keyPrefix = "eva-summary-offer:";

/** How many points the share must grow before a chat offers again. */
export const offerAgainStep = 10;

/** A stored share that a person or a later version broke hides nothing. */
export function hiddenShare(stored: string | null): number | null {
  // An empty text reads as 0, which is a share that would hide a chat for good.
  if (stored === null || stored.trim() === "") return null;
  const share = Number(stored);
  return Number.isInteger(share) && share >= 0 && share <= 100 ? share : null;
}

/** Whether a full chat shows its offer. `hidden` is the share at which the person put it off. */
export function offerShows(hidden: number | null, share: number): boolean {
  return hidden === null || share >= hidden + offerAgainStep;
}

/** A private window or blocked storage throws: the chat then shows its offer. */
export function readHiddenShare(chatId: string): number | null {
  try {
    return hiddenShare(localStorage.getItem(`${keyPrefix}${chatId}`));
  } catch {
    return null;
  }
}

export function hideOffer(chatId: string, share: number): void {
  try {
    localStorage.setItem(`${keyPrefix}${chatId}`, String(share));
  } catch {
    // The offer still stays away until the page reloads.
  }
}
