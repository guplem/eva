import { describe, expect, test } from "bun:test";
import { placeWords, readShareChoice } from "../../../../../src/frontends/web/client/location-words.ts";

const now = new Date("2026-10-22T08:00:00.000Z");

describe("placeWords", () => {
  test("says where the location came from, and how old it is", () => {
    const at = (minutes: number): string => new Date(now.getTime() - minutes * 60_000).toISOString();
    const place = { latitude: 1, longitude: 2, accuracy: null, source: "telegram" as const, at: at(0) };
    expect(placeWords(place, now)).toBe("Eva knows your location from Telegram, just now.");
    expect(placeWords({ ...place, at: at(1) }, now)).toBe("Eva knows your location from Telegram, 1 minute ago.");
    expect(placeWords({ ...place, source: "web", at: at(14) }, now)).toBe(
      "Eva knows your location from this web app, 14 minutes ago.",
    );
    expect(placeWords({ ...place, at: at(60) }, now)).toContain("1 hour ago");
    expect(placeWords({ ...place, at: at(300) }, now)).toContain("5 hours ago");
  });

  test("names the home place, and an unknown place", () => {
    expect(placeWords({ latitude: 1, longitude: 2, accuracy: null, source: "home", at: null }, now)).toContain(
      "home place",
    );
    expect(placeWords(null, now)).toBe("Eva does not know where you are yet.");
  });
});

describe("readShareChoice", () => {
  test("is on only when this browser said so", () => {
    expect(readShareChoice({ getItem: () => "on" })).toBe(true);
    expect(readShareChoice({ getItem: () => null })).toBe(false);
    expect(readShareChoice(null)).toBe(false);
    expect(
      readShareChoice({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(false);
  });
});
