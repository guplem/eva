import { describe, expect, test } from "bun:test";
import {
  personWords,
  reportHasMore,
  reportHeadline,
  reportPlace,
  reportPreview,
  turnLine,
  type ProjectReport,
} from "../../../src/shared/project-report.ts";

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

describe("reportPreview and reportHasMore", () => {
  test("skip a heading-only paragraph, such as a summary title", () => {
    expect(reportPreview({ ...report, result: "## Summary\n\nFixed the bug." })).toBe("Fixed the bug.");
  });

  test("say whether the whole result holds more than the preview", () => {
    expect(reportHasMore({ ...report, result: "Fixed it." })).toBe(false);
    expect(reportHasMore({ ...report, result: "## Done\n\nFixed it." })).toBe(true);
    expect(reportHasMore(report)).toBe(true);
    expect(reportHasMore({ ...report, result: "Fixed it.", resultCut: true })).toBe(true);
    expect(reportHasMore({ ...report, result: "word ".repeat(100) })).toBe(true);
  });
});

describe("personWords and turnLine", () => {
  const evaTurn = { userText: "[Project work finished: x]", fromEva: true, projectReports: [report], personText: null };

  test("a result that Eva sent alone has no words of the person: its card stands for it", () => {
    expect(personWords(evaTurn)).toBeNull();
    expect(turnLine(evaTurn)).toBe("Eva finished the work in Example app");
  });

  test("a turn that gathered a result and the person's message keeps only the person's words", () => {
    const mixed = { ...evaTurn, fromEva: false, personText: "and the tests?" };
    expect(personWords(mixed)).toBe("and the tests?");
    expect(turnLine(mixed)).toBe("and the tests?");
  });

  test("any other turn shows its message", () => {
    const plain = { userText: "hi", fromEva: false, projectReports: [], personText: null };
    expect(personWords(plain)).toBe("hi");
    expect(personWords({ ...plain, fromEva: true })).toBe("hi");
  });
});
