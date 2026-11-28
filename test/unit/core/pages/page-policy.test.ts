import { describe, expect, test } from "bun:test";
import { pagePolicy } from "../../../../src/core/pages/page-policy.ts";
import { pageSandbox, widgetSandbox } from "../../../../src/shared/widget-sandbox.ts";

const base = "http://127.0.0.1:7420/widgets/abc/";

describe("pagePolicy (#1129)", () => {
  test("is exactly this policy: inline code, the theme file, and no network", () => {
    expect(pagePolicy(base, "http://127.0.0.1:7420")).toBe(
      [
        "sandbox allow-scripts",
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        `style-src 'unsafe-inline' ${base}eva/theme.css`,
        "img-src data: blob:",
        "media-src data: blob:",
        "font-src 'none'",
        "connect-src 'none'",
        "frame-src 'none'",
        "child-src 'none'",
        "worker-src 'none'",
        "manifest-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors http://127.0.0.1:7420",
      ].join("; "),
    );
  });

  test("names no host but Eva as the frame parent", () => {
    const policy = pagePolicy(base, "http://127.0.0.1:7420");
    expect(policy).not.toContain("https:");
    expect(policy).not.toContain("*");
    expect(policy).not.toContain("unsafe-eval");
  });
});

describe("pageSandbox (#1129)", () => {
  test("gives a page scripts only: no origin, no popup, no form, no top navigation", () => {
    expect(pageSandbox).toBe("allow-scripts");
  });

  test("leaves the sandbox of a widget as it is", () => {
    expect(widgetSandbox).toBe("allow-scripts allow-popups allow-popups-to-escape-sandbox");
  });
});
