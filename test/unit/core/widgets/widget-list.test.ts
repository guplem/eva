import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWidgetList, widgetListPath, writeWidgetList } from "../../../../src/core/widgets/widget-list.ts";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-widget-list-"));
  mkdirSync(join(vault, ".eva"));
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

function writeRaw(value: unknown): void {
  writeFileSync(widgetListPath(vault), typeof value === "string" ? value : JSON.stringify(value));
}

describe("readWidgetList", () => {
  test("reads nothing from a missing or broken file", () => {
    expect(readWidgetList(vault)).toEqual([]);
    writeRaw("{ not json");
    expect(readWidgetList(vault)).toEqual([]);
    writeRaw({ widgets: "no list" });
    expect(readWidgetList(vault)).toEqual([]);
  });

  test("reads each entry in order, in one address form, and skips a bad entry or a second one", () => {
    writeRaw({
      version: 1,
      widgets: [
        { repository: "Example-Owner/habits", enabled: true, inputs: { habits: "Life/Habits", count: 3, show: true } },
        { repository: "not an address", enabled: true },
        "text",
        { repository: "https://github.com/example-owner/HABITS", enabled: false },
        { repository: "https://github.com/example-owner/weather", enabled: "yes", inputs: { bad: { nested: 1 } } },
      ],
    });
    expect(readWidgetList(vault)).toEqual([
      {
        id: "example-owner/habits",
        repository: "https://github.com/Example-Owner/habits",
        enabled: true,
        inputs: { habits: "Life/Habits", count: 3, show: true },
      },
      {
        id: "example-owner/weather",
        repository: "https://github.com/example-owner/weather",
        enabled: false,
        inputs: {},
      },
    ]);
  });
});

describe("writeWidgetList", () => {
  test("writes the entries in the new order, and keeps every unknown key and each bad entry", () => {
    writeRaw({
      version: 1,
      note: "kept",
      widgets: [
        { repository: "example-owner/habits", enabled: true, inputs: {}, color: "blue" },
        { repository: "broken" },
        { repository: "example-owner/weather", enabled: false, inputs: {} },
      ],
    });
    const [habits, weather] = readWidgetList(vault);
    if (habits === undefined || weather === undefined) throw new Error("Both entries must read.");
    writeWidgetList(vault, [{ ...weather, enabled: true, inputs: { city: "Barcelona" } }, habits]);
    expect(JSON.parse(readFileSync(widgetListPath(vault), "utf-8"))).toEqual({
      version: 1,
      note: "kept",
      widgets: [
        { repository: "https://github.com/example-owner/weather", enabled: true, inputs: { city: "Barcelona" } },
        { repository: "https://github.com/example-owner/habits", enabled: true, inputs: {}, color: "blue" },
        { repository: "broken" },
      ],
    });
  });

  test("never writes over a file that it cannot read, and drops a second entry of one widget", () => {
    const entry = {
      id: "example-owner/habits",
      repository: "https://github.com/example-owner/habits",
      enabled: false,
      inputs: {},
    };
    for (const broken of ["{ not json", "[]", '{"widgets": "no list"}']) {
      writeRaw(broken);
      expect(() => writeWidgetList(vault, [entry])).toThrow("cannot read .eva/widgets.json");
      expect(readFileSync(widgetListPath(vault), "utf-8")).toBe(broken);
    }
    writeRaw({
      version: 1,
      widgets: [
        { repository: "example-owner/habits", enabled: false, inputs: {} },
        { repository: "https://github.com/example-owner/HABITS", enabled: true, inputs: {} },
      ],
    });
    writeWidgetList(vault, []);
    expect(readWidgetList(vault)).toEqual([]);
  });

  test("creates the file, and drops a removed entry", () => {
    writeWidgetList(vault, [
      { id: "example-owner/habits", repository: "https://github.com/example-owner/habits", enabled: false, inputs: {} },
    ]);
    expect(readWidgetList(vault)).toHaveLength(1);
    writeWidgetList(vault, []);
    expect(readWidgetList(vault)).toEqual([]);
  });
});
