import { afterEach, describe, expect, test } from "bun:test";
import {
  forgetOffer,
  hiddenShare,
  hideOffer,
  offerAgainStep,
  offerShows,
  readHiddenShare,
} from "../../../../../src/frontends/web/client/summary-offer.ts";

function useStorage(storage: unknown): void {
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

/** A storage that keeps its items in a map, as a browser does. */
function mapStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  } as unknown as Storage;
}

const blocked = (): never => {
  throw new Error("blocked");
};

describe("hiddenShare", () => {
  test("a whole number comes back, and anything else hides nothing", () => {
    expect(hiddenShare("80")).toBe(80);
    expect(hiddenShare("0")).toBe(0);
    expect(hiddenShare(null)).toBe(null);
    expect(hiddenShare("")).toBe(null);
    expect(hiddenShare("later")).toBe(null);
    expect(hiddenShare("-5")).toBe(null);
    expect(hiddenShare("120")).toBe(null);
    expect(hiddenShare(" ")).toBe(null);
    expect(hiddenShare("0x50")).toBe(null);
    expect(hiddenShare("12.5")).toBe(null);
  });
});

describe("offerShows", () => {
  test("a chat that nobody hid offers at once", () => {
    expect(offerShows(null, 75)).toBe(true);
  });

  test("a hidden chat stays quiet until its share grows by the step", () => {
    expect(offerShows(76, 76)).toBe(false);
    expect(offerShows(76, 85)).toBe(false);
    expect(offerShows(76, 76 + offerAgainStep)).toBe(true);
    expect(offerShows(76, 99)).toBe(true);
  });

  test("a share that fell after the engine compacted the chat stays quiet", () => {
    expect(offerShows(90, 40)).toBe(false);
  });

  test("a chat put off near the top has no room left to grow, so only the forget frees it", () => {
    expect(offerShows(95, 100)).toBe(false);
    expect(offerShows(null, 100)).toBe(true);
  });
});

describe("the browser's own choice", () => {
  afterEach(() => Reflect.deleteProperty(globalThis, "localStorage"));

  test("each chat keeps its own share, and another chat stays untouched", () => {
    useStorage(mapStorage());
    expect(readHiddenShare("chat-1")).toBeNull();
    hideOffer("chat-1", 78);
    expect(readHiddenShare("chat-1")).toBe(78);
    expect(readHiddenShare("chat-2")).toBeNull();
  });

  test("a chat that is no longer full forgets the choice, so it offers again when it fills", () => {
    useStorage(mapStorage());
    hideOffer("chat-1", 95);
    forgetOffer("chat-1");
    expect(readHiddenShare("chat-1")).toBeNull();
    expect(offerShows(readHiddenShare("chat-1"), 80)).toBe(true);
  });

  test("a blocked storage offers the chat and loses only the choice", () => {
    useStorage({ getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(readHiddenShare("chat-1")).toBeNull();
    expect(() => {
      hideOffer("chat-1", 78);
    }).not.toThrow();
    expect(() => {
      forgetOffer("chat-1");
    }).not.toThrow();
  });
});
