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
  googleCalendar: null,
  googleTasks: null,
  cases: false,
  asks: [],
  hosts: [],
  prompt: "Habits live in {habits}.",
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

describe("the prompt line of a record", () => {
  test("is null in a record from before the field", () => {
    const { prompt: _prompt, ...old } = record;
    writeFileSync(join(folder, "old.json"), JSON.stringify({ version: 1, approvals: [old] }));
    const read = new WidgetApprovals(join(folder, "old.json")).get("example-owner/habits");
    expect(read?.prompt).toBeNull();
    expect(read?.name).toBe("Habits");
  });
});

describe("the inputs of Eva's data in a record", () => {
  test("a record from before them reads as no calendar, no tasks and no cases", () => {
    const { googleCalendar: _calendar, googleTasks: _tasks, cases: _cases, ...old } = record;
    writeFileSync(join(folder, "old.json"), JSON.stringify({ version: 1, approvals: [old] }));
    const read = new WidgetApprovals(join(folder, "old.json")).get("example-owner/habits");
    expect(read?.googleCalendar).toBeNull();
    expect(read?.googleTasks).toBeNull();
    expect(read?.cases).toBe(false);
  });

  test("keeps the tasks access of contract 4", () => {
    const tasks: WidgetApproval = { ...record, googleTasks: "read" };
    new WidgetApprovals(path).save("example-owner/habits", tasks);
    expect(new WidgetApprovals(path).get("example-owner/habits")).toEqual(tasks);
  });

  test("a record from before contract 3 reads as no asks, and a record keeps its asks and the header size", () => {
    const { asks: _asks, ...old } = record;
    writeFileSync(join(folder, "old.json"), JSON.stringify({ version: 1, approvals: [old] }));
    expect(new WidgetApprovals(join(folder, "old.json")).get("example-owner/habits")?.asks).toEqual([]);
    const asking: WidgetApproval = { ...record, size: "header", asks: ["chat", "open"] };
    new WidgetApprovals(path).save("example-owner/habits", asking);
    expect(new WidgetApprovals(path).get("example-owner/habits")).toEqual(asking);
  });

  test("keeps the calendar access, the cases and a size of contract 2", () => {
    const wide: WidgetApproval = { ...record, size: "xlarge", googleCalendar: "read", cases: true };
    new WidgetApprovals(path).save("example-owner/habits", wide);
    expect(new WidgetApprovals(path).get("example-owner/habits")).toEqual(wide);
  });
});
