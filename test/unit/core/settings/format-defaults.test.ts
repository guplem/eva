import { describe, expect, test } from "bun:test";
import { hasLocale, localFormats, newVaultSettings } from "../../../../src/core/settings/format-defaults.ts";
import { defaultConfig } from "../../../../src/core/settings/home.ts";

describe("localFormats", () => {
  test("a US locale gives a 12-hour clock, a Sunday start and imperial units", () => {
    expect(localFormats("en-US")).toMatchObject({ clock: "12h", weekStart: "sunday", units: "imperial" });
  });

  test("a Spanish locale gives a 24-hour clock, a Monday start and metric units", () => {
    expect(localFormats("es-ES")).toMatchObject({ clock: "24h", weekStart: "monday", units: "metric" });
  });

  test("a locale with no region leaves the clock, the week start and the units unset", () => {
    expect(localFormats("de")).toMatchObject({ clock: null, weekStart: null, units: null });
    expect(localFormats("en", undefined, true)).toMatchObject({ clock: null, weekStart: null, units: null });
  });

  test("a computer with no locale set gives no forms, not the US fallback of the engine", () => {
    expect(localFormats(undefined, undefined, false)).toMatchObject({ clock: null, weekStart: null, units: null });
    // The browser's locale and zone serve on such a hub.
    expect(localFormats("es-ES", "Europe/Madrid", false)).toEqual({
      timeZone: "Europe/Madrid",
      clock: "24h",
      weekStart: "monday",
      units: "metric",
    });
  });

  test("a bad locale or zone from a page is skipped", () => {
    const machine = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(localFormats("not a locale!", "Not/AZone", false)).toEqual({
      timeZone: machine,
      clock: null,
      weekStart: null,
      units: null,
    });
  });
});

describe("hasLocale", () => {
  test("like ICU, the first variable that is set decides, and C or POSIX is no locale", () => {
    expect(hasLocale({}, "linux")).toBe(false);
    expect(hasLocale({ LANG: "C.UTF-8" }, "linux")).toBe(false);
    expect(hasLocale({ LC_ALL: "POSIX" }, "linux")).toBe(false);
    expect(hasLocale({ LANG: "es_ES.UTF-8" }, "linux")).toBe(true);
    expect(hasLocale({ LANG: "C", LC_TIME: "en_GB.UTF-8" }, "linux")).toBe(false);
    expect(hasLocale({ LC_ALL: "C", LANG: "es_ES.UTF-8" }, "linux")).toBe(false);
    expect(hasLocale({ LC_ALL: "es_ES.UTF-8", LANG: "C" }, "linux")).toBe(true);
    expect(hasLocale({ LC_MESSAGES: "es_ES.UTF-8", LANG: "C" }, "linux")).toBe(true);
  });

  test("a Mac with no locale variable has none, and Windows always has one", () => {
    expect(hasLocale({}, "darwin")).toBe(false);
    expect(hasLocale({ LANG: "es_ES.UTF-8" }, "darwin")).toBe(true);
    expect(hasLocale({}, "win32")).toBe(true);
  });
});

describe("newVaultSettings", () => {
  const local = { timeZone: "Europe/Madrid", clock: "24h", weekStart: "monday", units: "metric" } as const;

  test("fills the answer language and each empty setting from the computer", () => {
    expect(newVaultSettings(defaultConfig, "Spanish", local)).toEqual({
      language: "Spanish",
      timeZone: "Europe/Madrid",
      clock: "24h",
      weekStart: "monday",
      units: "metric",
    });
  });

  test("keeps a setting that holds a value, and skips what the computer cannot tell", () => {
    const config = { ...defaultConfig, timeZone: "Asia/Tokyo" } as const;
    expect(newVaultSettings(config, "English", { ...local, clock: null, weekStart: null, units: null })).toEqual({
      language: "English",
    });
  });
});
