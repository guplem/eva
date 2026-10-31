import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WidgetApprovals, type WidgetApproval } from "../../../../src/core/widgets/widget-approvals.ts";

let folder: string;
let path: string;

const record: WidgetApproval = {
  repository: "https://github.com/example-owner/habits",
  commit: "a".repeat(40),
  name: "Habits",
  size: "medium",
  entry: "index.html",
  paths: [
    {
      input: "habits",
      type: "folder",
      path: "Life/Habits",
      access: "write",
      files: "*.json",
      schema: "schemas/habits.json",
    },
  ],
  location: false,
  hosts: [],
  approvedAt: "2026-01-01T09:00:00.000Z",
};

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-widget-approvals-"));
  path = join(folder, "state", "widget-approvals.json");
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("WidgetApprovals", () => {
  test("keeps a record across a restart, and removes it", () => {
    new WidgetApprovals(path).save("example-owner/habits", record);
    const again = new WidgetApprovals(path);
    expect(again.get("example-owner/habits")).toEqual(record);
    expect(again.get("example-owner/other")).toBeNull();
    again.remove("example-owner/habits");
    again.remove("example-owner/habits");
    expect(new WidgetApprovals(path).get("example-owner/habits")).toBeNull();
  });

  test("drops a broken file and a broken record", () => {
    writeFileSync(join(folder, "broken.json"), "{");
    expect(new WidgetApprovals(join(folder, "broken.json")).get("example-owner/habits")).toBeNull();
    writeFileSync(
      join(folder, "mixed.json"),
      JSON.stringify({
        version: 1,
        approvals: [
          { ...record, commit: "main" },
          { ...record, repository: "not an address" },
          { ...record, repository: "https://github.com/example-owner/weather" },
        ],
      }),
    );
    const mixed = new WidgetApprovals(join(folder, "mixed.json"));
    expect(mixed.get("example-owner/habits")).toBeNull();
    expect(mixed.get("example-owner/weather")?.name).toBe("Habits");
  });
});
