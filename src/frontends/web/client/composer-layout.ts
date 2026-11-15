/**
 * The adaptive message box (#943). On a short screen the box is one row: the + button, the text and Send. The + button
 * opens every setting of the row. The text grows with the screen, so the box always leaves room to read the chat.
 */

/** A visible window lower than this folds the box to one row. A phone keyboard makes the visible window lower. */
export const shortWindow = 640;

/** The share of the visible window that the text takes before it scrolls. */
const textShare = 0.28;
const fewestLines = 3;
const mostLines = 10;
/** The line of the usual 14 px text, for a browser that gives no line height. */
const usualLine = 21;

/**
 * True when the box shows one row. A phone always folds, also with the keyboard down: the keyboard takes a moment to
 * open, and a row that comes and goes in that moment would jump.
 */
export function foldsToOneRow(screen: {
  readonly visibleHeight: number;
  readonly touch: boolean;
  /** True on a screen whose short side is a phone's. */
  readonly phoneSized: boolean;
}): boolean {
  return screen.visibleHeight < shortWindow || (screen.touch && screen.phoneSized);
}

/** The tallest height of the text before it scrolls, in whole lines: 3 to 10, by the height of the visible window. */
export function autoTextHeight(visibleHeight: number, lineHeight: number): number {
  const line = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : usualLine;
  const lines = Math.min(mostLines, Math.max(fewestLines, Math.floor((visibleHeight * textShare) / line)));
  return lines * line;
}
