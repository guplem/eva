import { describe, expect, test } from "bun:test";
import { knownTimeZones, timeZoneChoices } from "../../../../../src/frontends/web/client/time-zones.ts";

const known = ["America/New_York", "Europe/Madrid", "UTC"];

describe("timeZoneChoices", () => {
  test("puts the machine's own zone first, as the empty value", () => {
    expect(timeZoneChoices("", known)[0]).toEqual({ value: "", label: "This machine's own" });
  });

  test("lists each known zone, with its underscores as spaces", () => {
    expect(timeZoneChoices("", known).slice(1)).toEqual([
      { value: "America/New_York", label: "America/New York" },
      { value: "Europe/Madrid", label: "Europe/Madrid" },
      { value: "UTC", label: "UTC" },
    ]);
  });

  test("keeps a saved zone that the browser does not know, so Save never drops it", () => {
    const values = timeZoneChoices("Etc/GMT+3", known).map((choice) => choice.value);
    expect(values).toContain("Etc/GMT+3");
    expect(values.filter((value) => value === "Europe/Madrid")).toHaveLength(1);
  });

  test("adds no copy of a saved zone that the list has", () => {
    expect(timeZoneChoices("Europe/Madrid", known)).toHaveLength(known.length + 1);
  });
});

describe("knownTimeZones", () => {
  test("gives the zones that the runtime knows", () => {
    expect(knownTimeZones()).toContain("Europe/Madrid");
  });
});
