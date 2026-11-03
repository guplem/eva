import { afterEach, describe, expect, test } from "bun:test";
import {
  displayFormat,
  onDisplayFormatChange,
  setDisplayFormat,
} from "../../../../../src/frontends/web/client/display-format.ts";

afterEach(() => {
  setDisplayFormat(undefined);
});

describe("display format (#770)", () => {
  test("a new format reaches each listener at once, as after a save on the Settings page", () => {
    let calls = 0;
    const stop = onDisplayFormatChange(() => (calls += 1));
    expect(setDisplayFormat({ clock: "12h", weekStart: "sunday" })).toBe(true);
    expect(displayFormat()).toEqual({ clock: "12h", weekStart: "sunday" });
    // The same values again change nothing, and a value that the page does not know reads as not set.
    expect(setDisplayFormat({ clock: "12h", weekStart: "sunday" })).toBe(false);
    setDisplayFormat({ clock: "13h" as never, weekStart: "sunday" });
    expect(displayFormat().clock).toBeNull();
    expect(calls).toBe(2);
    stop();
    setDisplayFormat({ clock: "24h", weekStart: null });
    expect(calls).toBe(2);
  });
});
