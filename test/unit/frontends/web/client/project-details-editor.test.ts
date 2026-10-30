import { describe, expect, test } from "bun:test";
import { projectStatuses } from "../../../../../src/core/projects/project-catalog.ts";
import { statusChoices, statusOf } from "../../../../../src/frontends/web/client/ProjectDetailsEditor.tsx";

describe("the status choices", () => {
  test("offer None and each status of the catalog, so a new status reaches the form (#690)", () => {
    expect(statusChoices.map((choice) => choice.value)).toEqual(["", ...projectStatuses]);
    expect(statusChoices.find((choice) => choice.value === "in-use")?.label).toBe("In use");
  });

  test("read a choice back as its status, and None or an unknown value as no status", () => {
    for (const status of projectStatuses) expect(statusOf(status)).toBe(status);
    expect(statusOf("")).toBeNull();
    expect(statusOf("dreaming")).toBeNull();
  });
});
