import { describe, expect, test } from "bun:test";
import { themeCss, widgetPolicy, widgetTheme } from "../../../../src/core/widgets/widget-policy.ts";

describe("widgetTheme and themeCss", () => {
  test("keep the plain colours of the contract and set the mode", () => {
    const theme = widgetTheme("dark", {
      "--bg": "oklch(0.16 0.02 245.1)",
      "--accent": " #2aa8ff ",
      "--panel": "rgb(255 255 255 / 0.5)",
      "--chip": "transparent",
      "--soft": "oklch(0.945 calc(0.164 * 0.25) 245.1)",
      "--other": "red",
    });
    expect(theme).toEqual({
      scheme: "dark",
      colors: {
        "--bg": "oklch(0.16 0.02 245.1)",
        "--panel": "rgb(255 255 255 / 0.5)",
        "--chip": "transparent",
        "--accent": "#2aa8ff",
        "--soft": "oklch(0.945 calc(0.164 * 0.25) 245.1)",
      },
    });
    expect(themeCss(theme)).toBe(
      ":root {\n  color-scheme: dark;\n  --bg: oklch(0.16 0.02 245.1);\n  --panel: rgb(255 255 255 / 0.5);\n  --chip: transparent;\n  --accent: #2aa8ff;\n  --soft: oklch(0.945 calc(0.164 * 0.25) 245.1);\n}\n",
    );
  });

  test("drop a value that could load a file or leave its declaration", () => {
    const theme = widgetTheme("light", {
      "--bg": "url(https://evil.example/x)",
      "--ink": "red; } body { display: none",
      "--line": 'red"',
      "--chip": "red\\",
      "--muted": "x".repeat(121),
      "--ok": "",
      "--ok-bg": "url(//evil.example/a)",
      "--warn": "red /* x",
      "--warn-bg": "expression(1)",
    });
    expect(theme.colors).toEqual({});
    expect(themeCss(theme)).toBe(":root {\n  color-scheme: light;\n\n}\n");
  });
});

describe("widgetPolicy", () => {
  test("allows the token path, the approved hosts and Eva as the frame parent, and sandboxes the page", () => {
    const base = "http://127.0.0.1:7420/widgets/abc/";
    const policy = widgetPolicy(base, "http://127.0.0.1:7420", ["https://api.example.com"]);
    const directives: Record<string, string> = Object.fromEntries(
      policy
        .split("; ")
        .map((part): [string, string] => [part.split(" ")[0] ?? "", part.split(" ").slice(1).join(" ")]),
    );
    expect(directives).toEqual({
      sandbox: "allow-scripts",
      "default-src": base,
      "script-src": base,
      "style-src": base,
      "font-src": base,
      "connect-src": `${base} https://api.example.com`,
      "img-src": `${base} data: blob: https://api.example.com`,
      "media-src": `${base} https://api.example.com`,
      "frame-src": "'none'",
      "worker-src": "'none'",
      "object-src": "'none'",
      "base-uri": "'none'",
      "form-action": "'none'",
      "frame-ancestors": "http://127.0.0.1:7420",
    });
    expect(widgetPolicy(base, "http://127.0.0.1:7420", [])).toContain(`connect-src ${base};`);
  });
});
