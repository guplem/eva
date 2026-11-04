import { describe, expect, test } from "bun:test";
import { projectStatuses } from "../../../../../src/shared/project-statuses.ts";
import { statusChoices, statusOf } from "../../../../../src/frontends/web/client/project-format.ts";

describe("the status choices", () => {
  test("offer None and each status of the catalog, so a new status reaches the form (#690)", () => {
    expect(statusChoices.map((choice) => choice.value)).toEqual(["", ...projectStatuses]);
    expect(statusChoices.map((choice) => choice.label)).toEqual(["None", "Active", "Paused", "Closed"]);
  });

  test("read a choice back as its status, and None or an unknown value as no status", () => {
    for (const status of projectStatuses) expect(statusOf(status)).toBe(status);
    expect(statusOf("")).toBeNull();
    expect(statusOf("dreaming")).toBeNull();
    // In use is a flag, never a status (#859).
    expect(statusOf("in-use")).toBeNull();
  });
});
