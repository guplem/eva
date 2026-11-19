import { describe, expect, test } from "bun:test";
import { hiddenShare, offerAgainStep, offerShows } from "../../../../../src/frontends/web/client/summary-offer.ts";

describe("hiddenShare", () => {
  test("a whole number comes back, and anything else hides nothing", () => {
    expect(hiddenShare("80")).toBe(80);
    expect(hiddenShare("0")).toBe(0);
    expect(hiddenShare(null)).toBe(null);
    expect(hiddenShare("")).toBe(null);
    expect(hiddenShare("later")).toBe(null);
    expect(hiddenShare("-5")).toBe(null);
    expect(hiddenShare("120")).toBe(null);
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
});
