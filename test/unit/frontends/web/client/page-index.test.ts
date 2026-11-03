import { describe, expect, test } from "bun:test";
import {
  currentEntry,
  hasPageIndex,
  itemOfCardId,
  sameEntries,
} from "../../../../../src/frontends/web/client/page-index.ts";
import { cardId, designReferenceItem } from "../../../../../src/frontends/web/client/settings-routes.ts";

describe("itemOfCardId", () => {
  test("reads the item back from a card's element id", () => {
    expect(itemOfCardId(cardId("vault-sync"))).toBe("vault-sync");
  });

  test("an element that is not a card has no item", () => {
    expect(itemOfCardId("guide-chats")).toBeNull();
    expect(itemOfCardId("setting-")).toBeNull();
  });
});

describe("hasPageIndex", () => {
  test("a section page of cards has an index", () => {
    expect(hasPageIndex({ section: "vault", item: null })).toBe(true);
    expect(hasPageIndex({ section: "personalize", item: "sounds" })).toBe(true);
    expect(hasPageIndex({ section: "developer", item: null })).toBe(true);
  });

  test("the home, the setup steps, the guide and the design reference have none", () => {
    expect(hasPageIndex({ section: null, item: null })).toBe(false);
    expect(hasPageIndex({ section: "setup", item: null })).toBe(false);
    expect(hasPageIndex({ section: "setup", item: "vault" })).toBe(false);
    expect(hasPageIndex({ section: "guide", item: null })).toBe(false);
    expect(hasPageIndex({ section: "developer", item: designReferenceItem })).toBe(false);
  });
});

describe("currentEntry", () => {
  const cards = [
    { item: "a", top: -500 },
    { item: "b", top: 40 },
    { item: "c", top: 600 },
  ];

  test("the card whose top passed the reading line is the current one", () => {
    expect(currentEntry(cards, 100, false)).toBe("b");
    expect(currentEntry(cards, 30, false)).toBe("a");
  });

  test("before the first card passes the line, the first card is current", () => {
    expect(currentEntry([{ item: "a", top: 200 }], 100, false)).toBe("a");
  });

  test("at the bottom of the page, the last card is current, even when it is short", () => {
    expect(currentEntry(cards, 100, true)).toBe("c");
  });

  test("a page with no card has no current entry", () => {
    expect(currentEntry([], 100, false)).toBeNull();
  });
});

describe("sameEntries", () => {
  const entries = [
    { item: "a", title: "A" },
    { item: "b", title: "B" },
  ];

  test("the same cards in the same order are the same index", () => {
    expect(sameEntries(entries, [...entries])).toBe(true);
  });

  test("a new card, a new title or a new order is another index", () => {
    expect(sameEntries(entries, entries.slice(0, 1))).toBe(false);
    expect(sameEntries(entries, [entries[0]!, { item: "b", title: "Bee" }])).toBe(false);
    expect(sameEntries(entries, [...entries].reverse())).toBe(false);
  });
});
