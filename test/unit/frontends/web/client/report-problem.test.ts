import { describe, expect, test } from "bun:test";
import { problemReportUrl } from "../../../../../src/frontends/web/client/report-problem.ts";

const facts = { version: "1.2.3", install: "executable", role: "hub", browser: "Example Browser 1.0" } as const;

function parts(url: string): { title: string; body: string; base: string } {
  const parsed = new URL(url);
  return {
    base: `${parsed.origin}${parsed.pathname}`,
    title: parsed.searchParams.get("title") ?? "",
    body: parsed.searchParams.get("body") ?? "",
  };
}

describe("the link that reports a problem", () => {
  test("a bug opens a new issue in Eva's repository, with the facts of this Eva", () => {
    const report = parts(problemReportUrl("bug", facts));
    expect(report.base).toBe("https://github.com/guplem/eva/issues/new");
    expect(report.title).toBe("Bug: ");
    expect(report.body).toContain("Steps to reproduce");
    expect(report.body).toContain("Eva version: 1.2.3 (executable)");
    expect(report.body).toContain("Machine: hub");
    expect(report.body).toContain("Browser: Example Browser 1.0");
  });

  test("a change idea asks what to change, not how to reproduce it", () => {
    const report = parts(problemReportUrl("change", facts));
    expect(report.title).toBe("Feature: ");
    expect(report.body).toContain("What would you change");
    expect(report.body).not.toContain("Steps to reproduce");
    expect(report.body).toContain("Eva version: 1.2.3");
  });

  test("a fact that did not load says so, so the link still works", () => {
    const report = parts(problemReportUrl("bug", { version: null, install: null, role: null, browser: "B" }));
    expect(report.body).toContain("Eva version: unknown");
    expect(report.body).toContain("Machine: unknown");
  });
});
