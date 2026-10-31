import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WidgetUpdates } from "../../../../src/core/widgets/widget-updates.ts";

let folder: string;
let path: string;
const repository = "https://github.com/example-owner/habits";
const commit = "a".repeat(40);

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-widget-updates-"));
  path = join(folder, "widget-updates.json");
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("WidgetUpdates", () => {
  test("keeps each state across a restart, and drops an empty one", () => {
    const updates = new WidgetUpdates(path);
    const waiting = { commit, permissions: ["Read your last location."], reasons: [], notes: [], foundAt: "x" };
    updates.set("example-owner/habits", repository, { checkedAt: "2026-01-01T09:00:00.000Z", waiting });
    const again = new WidgetUpdates(path);
    expect(again.waiting()).toEqual([{ id: "example-owner/habits", repository, waiting }]);
    again.set("example-owner/habits", repository, { checkedAt: null, waiting: null });
    expect(new WidgetUpdates(path).get("example-owner/habits")).toBeNull();
    again.set("example-owner/habits", repository, { refused: commit });
    again.remove("example-owner/habits");
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual({ version: 1, widgets: [] });
  });

  test("a broken file or entry is no crash", () => {
    writeFileSync(path, "{ broken");
    expect(new WidgetUpdates(path).waiting()).toEqual([]);
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        widgets: [{ repository: "x" }, { repository, checkedAt: null, waiting: null, refused: "main" }],
      }),
    );
    expect(new WidgetUpdates(path).get("example-owner/habits")).toBeNull();
  });
});
