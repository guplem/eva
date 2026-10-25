import { describe, expect, test } from "bun:test";
import { reportHeadline, reportPlace, reportPreview, type ProjectReport } from "../../../src/shared/project-report.ts";

const report: ProjectReport = {
  projectId: "2025-03-02-1015-example-app",
  projectTitle: "Example app",
  projectSessionId: "p1",
  request: "Fix the login bug.",
  clone: "clone-0",
  repositories: [{ name: "example-app", branch: "main", pullRequest: 12 }],
  failed: false,
  result: "Fixed the login bug.\n\nThe tests pass.",
  resultCut: false,
};

describe("reportHeadline", () => {
  test("says that the work in the project finished, or failed", () => {
    expect(reportHeadline(report)).toBe("Eva finished the work in Example app");
    expect(reportHeadline({ ...report, failed: true })).toBe("The work in Example app failed");
  });
});

describe("reportPlace", () => {
  test("names the clone, then each repository with its branch and pull request", () => {
    expect(reportPlace(report)).toBe("clone-0 · example-app on main, PR #12");
    expect(
      reportPlace({
        ...report,
        repositories: [
          { name: "api", branch: null, pullRequest: null },
          { name: "web", branch: "fix-login", pullRequest: null },
        ],
      }),
    ).toBe("clone-0 · api · web on fix-login");
  });
});

describe("reportPreview", () => {
  test("shows the first paragraph of the result", () => {
    expect(reportPreview(report)).toBe("Fixed the login bug.");
  });

  test("cuts a long paragraph, and marks the start of a result that holds only its end", () => {
    const long = "word ".repeat(100).trim();
    const preview = reportPreview({ ...report, result: long });
    expect(preview.length).toBeLessThanOrEqual(241);
    expect(preview.endsWith("…")).toBe(true);
    expect(reportPreview({ ...report, result: "the end of it.", resultCut: true })).toBe("…the end of it.");
  });
});
