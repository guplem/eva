import { describe, expect, test } from "bun:test";
import { allowedWords, describeDevice } from "../../../../../src/frontends/web/client/device-words.ts";

// The local API keeps the first 120 characters of the user agent.
const label = (agent: string): string => `owner@example.com, ${agent.slice(0, 120)}`;

describe("describeDevice", () => {
  test("a computer gets its system, its browser and the laptop icon", () => {
    expect(
      describeDevice(
        label(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ),
      ),
    ).toEqual({ name: "Windows computer", browser: "Chrome", account: "owner@example.com", icon: "laptop" });
    expect(
      describeDevice(label("Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0")),
    ).toMatchObject({ name: "Linux computer", browser: "Firefox", icon: "laptop" });
    expect(
      describeDevice(
        label(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
        ),
      ),
    ).toMatchObject({ name: "Mac", browser: "Safari", icon: "laptop" });
  });

  test("a phone gets the phone icon, also when the label cuts the user agent", () => {
    expect(
      describeDevice(
        label(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        ),
      ),
    ).toEqual({ name: "iPhone", browser: "Safari", account: "owner@example.com", icon: "phone" });
    expect(
      describeDevice(
        label(
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        ),
      ),
    ).toMatchObject({ name: "Android", browser: "Chrome", icon: "phone" });
    // Samsung Internet: the label cuts the user agent before "Mobile", so a phone and a tablet look the same.
    expect(
      describeDevice(
        label(
          "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
        ),
      ),
    ).toMatchObject({ name: "Android", icon: "phone" });
    expect(
      describeDevice(
        label("Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"),
      ),
    ).toMatchObject({ name: "Android", icon: "phone" });
    expect(describeDevice(label("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) CriOS/120.0"))).toMatchObject({
      name: "iPad",
      browser: "Chrome",
    });
  });

  test("Edge, Opera and Firefox on iOS are not taken for Chrome or Safari", () => {
    expect(describeDevice(label("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 Edg/120.0"))).toMatchObject({
      browser: "Edge",
    });
    expect(describeDevice(label("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36 OPR/105.0"))).toMatchObject({
      browser: "Opera",
    });
    expect(
      describeDevice(label("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) FxiOS/121.0 Mobile Safari/605.1")),
    ).toMatchObject({ browser: "Firefox" });
  });

  test("an unknown user agent shows its own text as the browser", () => {
    expect(describeDevice("owner@example.com, a phone")).toEqual({
      name: "Device",
      browser: "a phone",
      account: "owner@example.com",
      icon: "laptop",
    });
    expect(describeDevice("no comma here")).toEqual({
      name: "Device",
      browser: "no comma here",
      account: null,
      icon: "laptop",
    });
  });
});

describe("allowedWords", () => {
  // Local times, so the tests pass in each time zone.
  const now = new Date(2026, 9, 19, 18, 30);

  test("says today, yesterday, the weekday or the date", () => {
    expect(allowedWords(new Date(2026, 9, 19, 9, 0).toISOString(), now)).toBe("allowed today");
    expect(allowedWords(new Date(2026, 9, 18, 23, 0).toISOString(), now)).toBe("allowed yesterday");
    expect(allowedWords(new Date(2026, 9, 16, 12, 0).toISOString(), now)).toBe("allowed 3 days ago");
    expect(allowedWords(new Date(2026, 8, 2, 12, 0).toISOString(), now)).toBe("allowed 2 Sep");
    expect(allowedWords(new Date(2025, 8, 2, 12, 0).toISOString(), now)).toBe("allowed 2 Sep 2025");
  });

  test("a bad stored date says only allowed", () => {
    expect(allowedWords("not a date", now)).toBe("allowed");
  });
});
