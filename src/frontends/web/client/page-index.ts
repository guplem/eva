/**
 * The index of a Settings page: which pages get one, how a card's element id maps back to its item,
 * and which card the person reads now. Pure, so a test covers it without a browser.
 */
import { cardId, designReferenceItem, type SettingsRoute } from "./settings-routes.ts";

const cardPrefix = cardId("");

/** One entry of the index: a card on the page, in page order. */
export interface PageIndexEntry {
  readonly item: string;
  readonly title: string;
}

/** The item of a card's element id, or null for an element that is not a card. */
export function itemOfCardId(id: string): string | null {
  if (!id.startsWith(cardPrefix) || id.length === cardPrefix.length) return null;
  return id.slice(cardPrefix.length);
}

/** A section page of cards gets an index. The setup steps, the guide and the design reference have their own pages. */
export function hasPageIndex(route: SettingsRoute): boolean {
  if (route.section === null || route.section === "setup" || route.section === "guide") return false;
  return !(route.section === "developer" && route.item === designReferenceItem);
}

/**
 * The card that the person reads: the last card whose top passed the reading line.
 * `top` is the distance from the top of the scroll box. At the bottom, the last card wins:
 * a short last card never reaches the line.
 */
export function currentEntry(
  cards: readonly { readonly item: string; readonly top: number }[],
  line: number,
  atBottom: boolean,
): string | null {
  if (cards.length === 0) return null;
  if (atBottom) return cards[cards.length - 1]?.item ?? null;
  let current = cards[0]?.item ?? null;
  for (const card of cards) if (card.top <= line) current = card.item;
  return current;
}

/** True when two indexes list the same cards, with the same titles, in the same order. */
export function sameEntries(first: readonly PageIndexEntry[], second: readonly PageIndexEntry[]): boolean {
  return (
    first.length === second.length &&
    first.every((entry, index) => entry.item === second[index]?.item && entry.title === second[index].title)
  );
}
