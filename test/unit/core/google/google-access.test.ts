import { describe, expect, test } from "bun:test";
import { googleAccessPresets, matchingGoogleAccessPreset } from "../../../../src/core/google/google-access.ts";
import { defaultConfig, googleAccessLevels } from "../../../../src/core/settings/home.ts";

describe("googleAccessPresets", () => {
  test("climb from read only to everything, and each step gives no less than the step before", () => {
    expect(googleAccessPresets.map((preset) => preset.id)).toEqual(["read", "lists", "drafts", "everything"]);
    for (const [index, preset] of googleAccessPresets.entries()) {
      const before = googleAccessPresets[index - 1];
      if (before === undefined) continue;
      for (const service of Object.keys(googleAccessLevels) as (keyof typeof googleAccessLevels)[]) {
        const levels: readonly string[] = googleAccessLevels[service];
        expect(levels.indexOf(preset.access[service])).toBeGreaterThanOrEqual(levels.indexOf(before.access[service]));
      }
    }
  });

  test("the first step is the default, and the last one gives each service its top level", () => {
    expect(googleAccessPresets[0]?.access).toEqual(defaultConfig.google.access);
    expect(googleAccessPresets.at(-1)?.access).toEqual({
      calendar: "full",
      drive: "full",
      contacts: "full",
      tasks: "full",
      gmail: "full",
    });
  });
});

describe("matchingGoogleAccessPreset", () => {
  test("names the preset with the same levels", () => {
    expect(matchingGoogleAccessPreset(defaultConfig.google.access)?.id).toBe("read");
    expect(
      matchingGoogleAccessPreset({
        calendar: "full",
        drive: "readonly",
        contacts: "full",
        tasks: "manage",
        gmail: "organize",
      })?.id,
    ).toBe("lists");
  });

  test("gives null when one level differs from every preset", () => {
    expect(matchingGoogleAccessPreset({ ...defaultConfig.google.access, contacts: "full" })).toBeNull();
  });
});
