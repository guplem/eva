/**
 * The index of a Settings page: a list of its cards. On a wide screen it sits under the open section
 * in the side list. On a phone it is a row at the top of the page. A press opens the card's address.
 */
import { useEffect, useState, type ReactElement } from "react";
import { currentEntry, itemOfCardId, sameEntries, type PageIndexEntry } from "./page-index.ts";

/** The reading line, from the top of the scroll box. A card whose top passes it is the one the person reads. */
const readingLine = 96;
/** The room under the end of the page that still counts as the bottom. */
const bottomRoom = 4;

export interface PageIndexState {
  readonly entries: readonly PageIndexEntry[];
  readonly current: string | null;
}

const empty: PageIndexState = { entries: [], current: null };

/**
 * Reads the cards of the open page, and follows the scroll. It reads the page, not a list, so a card
 * that does not show, such as one that waits for a vault, is not in the index.
 * `pageKey` changes with the page, so the index of the last page never shows on the new one.
 */
export function usePageIndex(pageKey: string | null): PageIndexState {
  const [state, setState] = useState<PageIndexState>(empty);
  useEffect(() => {
    setState(empty);
    if (pageKey === null) return;
    const box = document.querySelector(".settings-content");
    const page = document.querySelector(".settings-page");
    if (box === null || page === null) return;
    let frame = 0;
    const read = (): void => {
      frame = 0;
      const cards = [...page.querySelectorAll<HTMLElement>("section.card[id]")].flatMap((card) => {
        const item = itemOfCardId(card.id);
        return item === null ? [] : [{ item, title: card.getAttribute("aria-label") ?? item, card }];
      });
      const boxTop = box.getBoundingClientRect().top;
      const current = currentEntry(
        cards.map(({ item, card }) => ({ item, top: card.getBoundingClientRect().top - boxTop })),
        readingLine,
        box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - bottomRoom,
      );
      setState((before) => {
        const entries = cards.map(({ item, title }) => ({ item, title }));
        // The same state keeps the old object, so a scroll inside one card renders nothing.
        return before.current === current && sameEntries(before.entries, entries) ? before : { entries, current };
      });
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(read);
    };
    // A card can come late, after the data it shows loads.
    const observer = new MutationObserver(schedule);
    observer.observe(page, { childList: true, subtree: true });
    box.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      box.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [pageKey]);
  return state;
}

export function PageIndexList({
  state,
  className,
  onOpen,
}: {
  readonly state: PageIndexState;
  readonly className: string;
  readonly onOpen: (item: string) => void;
}): ReactElement | null {
  if (state.entries.length < 2) return null;
  return (
    <ol className={`page-index ${className}`} aria-label="On this page">
      {state.entries.map((entry) => (
        <li key={entry.item}>
          <button
            className="page-index-item"
            aria-current={entry.item === state.current ? "location" : undefined}
            onClick={() => onOpen(entry.item)}
          >
            {entry.title}
          </button>
        </li>
      ))}
    </ol>
  );
}
