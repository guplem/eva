import { describe, expect, test } from "bun:test";
import { localFormats, newVaultSettings } from "../../../../src/core/settings/format-defaults.ts";
import { defaultConfig } from "../../../../src/core/settings/home.ts";

describe("localFormats", () => {
  test("a US locale gives a 12-hour clock, a Sunday start and imperial units", () => {
    expect(localFormats("en-US")).toMatchObject({ clock: "12h", weekStart: "sunday", units: "imperial" });
  });

  test("a Spanish locale gives a 24-hour clock, a Monday start and metric units", () => {
    expect(localFormats("es-ES")).toMatchObject({ clock: "24h", weekStart: "monday", units: "metric" });
  });

  test("a locale with no region leaves the units unset", () => {
    expect(localFormats("de").units).toBeNull();
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
    const config = { ...defaultConfig, timeZone: "Asia/Tokyo", clock: "12h" } as const;
    expect(newVaultSettings(config, "English", { ...local, weekStart: null, units: null })).toEqual({
      language: "English",
    });
  });
});
