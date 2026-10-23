import { describe, expect, test } from "bun:test";
import {
  accessFrom,
  deviceKind,
  problemReportUrl,
  type ReportFacts,
} from "../../../../../src/frontends/web/client/report-problem.ts";

const facts: ReportFacts = {
  version: "1.2.3",
  install: "executable",
  role: "hub",
  browser: "Example Browser 1.0",
  device: "phone",
  screen: "390x844 at 3x",
  window: "390x664",
  access: "remote",
};

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

  test("holds the device, the screen and the way in, so a layout bug can be reproduced", () => {
    const report = parts(problemReportUrl("bug", facts));
    expect(report.body).toContain("Device: phone");
    expect(report.body).toContain("Screen: 390x844 at 3x");
    expect(report.body).toContain("Window: 390x664");
    expect(report.body).toContain("Opened from: another device, through Tailscale");
  });

  test("a change idea asks what to change, not how to reproduce it", () => {
    const report = parts(problemReportUrl("change", facts));
    expect(report.title).toBe("Feature: ");
    expect(report.body).toContain("What would you change");
    expect(report.body).not.toContain("Steps to reproduce");
    expect(report.body).toContain("Eva version: 1.2.3");
  });

  test("a fact that did not load says so, so the link still works", () => {
    const report = parts(problemReportUrl("bug", { ...facts, version: null, install: null, role: null }));
    expect(report.body).toContain("Eva version: unknown");
    expect(report.body).toContain("Machine: unknown");
  });
});

describe("the device kind", () => {
  test("tells a phone, a tablet and a computer apart", () => {
    expect(deviceKind("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148", 5)).toBe("phone");
    expect(deviceKind("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0 Mobile Safari/537.36", 5)).toBe("phone");
    expect(deviceKind("Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/120.0 Safari/537.36", 5)).toBe("tablet");
    expect(deviceKind("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 5)).toBe("tablet");
    expect(deviceKind("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0", 0)).toBe("computer");
  });

  test("calls a Mac with a touch screen a tablet: an iPad in desktop mode sends a Mac user agent", () => {
    expect(deviceKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", 5)).toBe("tablet");
    expect(deviceKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", 0)).toBe("computer");
  });
});

describe("the way in", () => {
  test("is local on a loopback address and remote anywhere else", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) expect(accessFrom(host)).toBe("local");
    expect(accessFrom("example-machine.example.ts.net")).toBe("remote");
    expect(accessFrom("100.64.0.1")).toBe("remote");
  });

  test("never puts the address itself in the issue: it names the person's machine", () => {
    const report = parts(problemReportUrl("bug", { ...facts, access: accessFrom("example-machine.example.ts.net") }));
    expect(report.body).not.toContain("example-machine");
    expect(parts(problemReportUrl("bug", { ...facts, access: "local" })).body).toContain(
      "Opened from: the machine that runs Eva",
    );
  });
});
