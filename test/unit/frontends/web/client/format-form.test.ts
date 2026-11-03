import { describe, expect, test } from "bun:test";
import { formatChange, formatFormChanged, formatFormOf } from "../../../../../src/frontends/web/client/format-form.ts";

const notSet = { clock: null, weekStart: null } as const;

describe("the Language and formats card (#770)", () => {
  test("starts from the settings, then from the values in use, such as one still only in About me", () => {
    expect(formatFormOf({ clock: "24h" }, { clock: "12h", units: "imperial", language: "Spanish" }, notSet)).toEqual({
      language: "Spanish",
      units: "imperial",
      clock: "24h",
      weekStart: "",
    });
  });

  test("after a save, the saved values are the baseline, so the leave guard stops asking", () => {
    const before = formatFormOf({}, undefined, notSet);
    const form = { ...before, clock: "12h" as const, language: "Catalan " };
    expect(formatFormChanged(form, before)).toBe(true);
    expect(formatChange(form)).toEqual({ language: "Catalan", units: null, clock: "12h", weekStart: null });
    // The baseline that Save sets.
    const baseline = form;
    expect(formatFormChanged(form, baseline)).toBe(false);
    expect(formatFormChanged({ ...form, weekStart: "sunday" }, baseline)).toBe(true);
  });
});
