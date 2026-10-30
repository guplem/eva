import { describe, expect, test } from "bun:test";
import type { SetupReport } from "../../../../../src/frontends/web/client/api.ts";
import {
  lightMark,
  proposalText,
  proposedType,
  reportSummary,
  scoreMark,
} from "../../../../../src/frontends/web/client/setup-report.ts";

function report(lights: readonly ("green" | "yellow" | "red" | "grey")[]): SetupReport {
  return {
    repositoryUrl: "https://github.com/example-owner/example-app",
    slug: "example-owner/example-app",
    type: "vibe-coded",
    sections: [
      {
        title: "Development",
        score: null,
        items: lights.map((light, index) => ({ label: `Item ${String(index)}`, light, detail: "", fixRequest: null })),
      },
    ],
    allFixes: null,
    problem: null,
  };
}

describe("a setup item's mark", () => {
  test("uses the marks of Settings", () => {
    expect(lightMark("green")).toBe("done");
    expect(lightMark("yellow")).toBe("missing");
    expect(lightMark("red")).toBe("failed");
  });

  test("gives no mark to an item that Eva did not check", () => {
    expect(lightMark("grey")).toBeNull();
  });
});

describe("a section's score", () => {
  test("is done only at 100 percent", () => {
    expect(scoreMark(100)).toBe("done");
    expect(scoreMark(50)).toBe("missing");
    expect(scoreMark(49)).toBe("failed");
  });
});

describe("the summary of a report", () => {
  test("counts the done items, without the ones that Eva did not check", () => {
    expect(reportSummary(report(["green", "yellow", "red", "grey"]))).toBe("1 of 3 items done. 1 not checked.");
  });

  test("says when every item is done", () => {
    expect(reportSummary(report(["green", "green"]))).toBe("All 2 items done.");
  });

  test("is empty for a report with no items", () => {
    expect(reportSummary(report([]))).toBe("");
  });
});

test("a report that Eva could not check counts only the unchecked items", () => {
  expect(reportSummary(report(["grey", "grey"]))).toBe("2 not checked.");
});

describe("the proposed type", () => {
  test("a repository with no type and a manifest gets the widget type as a proposal, with the reason", () => {
    const untyped = { ...report([]), type: null, proposedType: "widget" };
    const type = proposedType(untyped);
    expect(type?.name).toBe("widget");
    expect(type === null ? "" : proposalText(type)).toContain("eva-widget.json");
  });

  test("a repository with a type, or an unknown proposal, gets none", () => {
    expect(proposedType({ ...report([]), proposedType: "widget" })).toBeNull();
    expect(proposedType({ ...report([]), type: null, proposedType: "retired" })).toBeNull();
    expect(proposedType({ ...report([]), type: null })).toBeNull();
  });
});
