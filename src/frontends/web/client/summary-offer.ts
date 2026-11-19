/**
 * Which chats put off the notice that offers a new chat from a summary (issue 969). Each browser
 * keeps its own choice, as with the chat panel and the height of the message box.
 *
 * The choice is the share of the context window at which the person pressed "Not now". The notice
 * comes back when the share grows by `offerAgainStep` points. One "Not now" never silences a chat
 * that later fills up.
 *
 * A chat that is no longer full forgets the choice. So a chat that the engine compacted itself, and
 * that fills again, offers again. It also saves a person who said "Not now" near the top, where no
 * growth of `offerAgainStep` points is left.
 */

const keyPrefix = "eva-summary-offer:";

/** How many points the share must grow before a chat offers again. */
export const offerAgainStep = 10;

/** A stored share that a person or a later version broke hides nothing. */
export function hiddenShare(stored: string | null): number | null {
  // Only digits: `Number` also reads "", " " and "0x50", and each of those would hide a chat wrongly.
  if (stored === null || !/^\d{1,3}$/.test(stored)) return null;
  const share = Number(stored);
  return share <= 100 ? share : null;
}

/** Whether a full chat shows its notice. `hidden` is the share at which the person put it off. */
export function offerShows(hidden: number | null, share: number): boolean {
  return hidden === null || share >= hidden + offerAgainStep;
}

/** A private window or blocked storage throws: the chat then shows its notice. */
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
    // The notice stays hidden until the page reloads.
  }
}

/** Forgets the choice, so a chat that fills again offers again. */
export function forgetOffer(chatId: string): void {
  try {
    localStorage.removeItem(`${keyPrefix}${chatId}`);
  } catch {
    // Nothing was kept, so nothing is lost.
  }
}
