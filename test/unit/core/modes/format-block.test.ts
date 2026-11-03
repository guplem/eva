import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatBlock, formatSettingsOf } from "../../../../src/core/modes/format-block.ts";
import { defaultConfig } from "../../../../src/core/settings/home.ts";

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "eva-format-block-"));
  mkdirSync(join(vault, "Life"));
});
afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("formatSettingsOf", () => {
  test("reads the settings", () => {
    const config = {
      ...defaultConfig,
      language: "Spanish",
      units: "metric",
      clock: "24h",
      weekStart: "monday",
    } as const;
    expect(formatSettingsOf(config, vault)).toEqual({
      language: "Spanish",
      timeZone: null,
      units: "metric",
      clock: "24h",
      weekStart: "monday",
    });
  });

  test("a null setting falls back to the old About me field, for a vault that the hub has not migrated", () => {
    writeFileSync(
      join(vault, "Life", "About me.md"),
      "---\nunits: imperial\nclock: 12h\nweekStart: someday\n---\n\n- **Language for answers:** Spanish\n",
    );
    expect(formatSettingsOf({ ...defaultConfig, units: "metric" }, vault)).toMatchObject({
      language: "Spanish",
      units: "metric",
      clock: "12h",
      weekStart: null,
    });
  });

  test("without a vault or a value, each one is not set", () => {
    expect(formatSettingsOf(defaultConfig, null)).toEqual({
      language: null,
      timeZone: null,
      units: null,
      clock: null,
      weekStart: null,
    });
  });
});

describe("formatBlock", () => {
  test("names each empty setting as not set, and ends with the rule that the settings win", () => {
    const block = formatBlock(formatSettingsOf(defaultConfig, null));
    expect(block).toContain("- Answer language: not set\n- Time zone: not set\n");
    expect(block).toEndWith(
      "These settings win over any older rule about the answer language, dates, times or units.\n",
    );
  });
});
