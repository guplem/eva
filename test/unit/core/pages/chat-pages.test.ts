import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ChatPages,
  maxPageBytes,
  maxPageTokens,
  pageTokenLifeMs,
  resolveShownPage,
} from "../../../../src/core/pages/chat-pages.ts";
import { widgetTheme } from "../../../../src/core/widgets/widget-policy.ts";

let folder: string;
let vault: string;
let now: number;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "eva-pages-"));
  vault = join(folder, "vault");
  mkdirSync(vault, { recursive: true });
  now = Date.parse("2026-11-28T10:00:00Z");
});
afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

function write(path: string, text: string | Uint8Array): void {
  mkdirSync(dirname(join(vault, path)), { recursive: true });
  writeFileSync(join(vault, path), text);
}

const page = "<!doctype html><title>Chart</title><p>Hi</p>";
const theme = widgetTheme("dark", { "--accent": "#123456" });
const pages = (): ChatPages => new ChatPages({ vaultPath: vault, now: () => new Date(now) });

describe("resolveShownPage", () => {
  test("gives the file of a page in the vault", () => {
    write(".eva/scratch/chart.html", page);
    expect(resolveShownPage(vault, ".eva/scratch/chart.html")).toMatchObject({
      state: "ready",
      relativePath: ".eva/scratch/chart.html",
    });
    write("Notes/Old.HTM", page);
    expect(resolveShownPage(vault, "Notes/Old.HTM").state).toBe("ready");
  });

  test("says that a page is gone when its file does not exist", () => {
    expect(resolveShownPage(vault, ".eva/scratch/old.html")).toMatchObject({ state: "gone" });
  });

  test("refuses a page above 2 MB", () => {
    write(".eva/scratch/big.html", new Uint8Array(maxPageBytes + 1));
    expect(resolveShownPage(vault, ".eva/scratch/big.html")).toMatchObject({ state: "too-large" });
    write(".eva/scratch/edge.html", new Uint8Array(maxPageBytes));
    expect(resolveShownPage(vault, ".eva/scratch/edge.html").state).toBe("ready");
  });

  test("refuses a file that is not an HTML page", () => {
    write("Notes/plan.md", "# Plan\n");
    expect(resolveShownPage(vault, "Notes/plan.md")).toMatchObject({ state: "refused" });
  });

  test.each([
    ["a path outside the vault", "../outside.html"],
    ["an absolute path", "/etc/hosts.html"],
    ["a clone of a project", "Projects/2025-03-02-1015-example-app/repos/clone-1/app/index.html"],
    ["git data", ".git/page.html"],
    ["a file that holds a secret", ".eva/scratch/keys.html"],
  ])("refuses %s", (_name, path) => {
    writeFileSync(join(folder, "outside.html"), page);
    write("Projects/2025-03-02-1015-example-app/repos/clone-1/app/index.html", page);
    write(".git/page.html", page);
    write(".eva/scratch/keys.html", "<p>ghp_abcdefghijklmnopqrstuvwxyz0123456789</p>");
    expect(resolveShownPage(vault, path).state).not.toBe("ready");
  });

  test.skipIf(process.platform === "win32")("refuses a link that points out of the vault", () => {
    writeFileSync(join(folder, "outside.html"), page);
    mkdirSync(join(vault, ".eva", "scratch"), { recursive: true });
    symlinkSync(join(folder, "outside.html"), join(vault, ".eva", "scratch", "link.html"));
    expect(resolveShownPage(vault, ".eva/scratch/link.html")).toMatchObject({ state: "refused" });
  });

  test.skipIf(process.platform === "win32")("checks the extension of the file that a link names", () => {
    write("Notes/plan.md", "# Plan\n");
    mkdirSync(join(vault, ".eva", "scratch"), { recursive: true });
    symlinkSync(join(vault, "Notes", "plan.md"), join(vault, ".eva", "scratch", "plan.html"));
    expect(resolveShownPage(vault, ".eva/scratch/plan.html")).toMatchObject({ state: "refused" });
  });
});

describe("ChatPages", () => {
  test("gives a token path for a page, and serves the page and the theme under it", () => {
    write(".eva/scratch/chart.html", page);
    const store = pages();
    const frame = store.frame(".eva/scratch/chart.html", theme);
    if (frame.state !== "ready") throw new Error("The page is not ready.");
    expect(frame.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(frame.src).toBe(`/widgets/${frame.token}/page.html`);
    expect(store.has(frame.token)).toBe(true);
    const served = store.serve(frame.token, "page.html", "GET");
    expect(served).toMatchObject({ status: 200, contentType: "text/html; charset=utf-8" });
    expect(Buffer.from(served?.body as Uint8Array).toString("utf8")).toBe(page);
    const css = store.serve(frame.token, "eva/theme.css", "GET");
    expect(css).toMatchObject({ status: 200, contentType: "text/css; charset=utf-8" });
    expect(String(css?.body)).toContain("--accent: #123456;");
    expect(String(css?.body)).toContain("color-scheme: dark;");
    expect(store.serve(frame.token, "page.html", "HEAD")?.status).toBe(200);
  });

  test("gives the note of a page that it cannot show, and no token", () => {
    const frame = pages().frame(".eva/scratch/old.html", theme);
    expect(frame).toMatchObject({ state: "gone" });
    expect("token" in frame).toBe(false);
  });

  test("serves no other path and no other method", () => {
    write(".eva/scratch/chart.html", page);
    write(".eva/scratch/other.html", page);
    const store = pages();
    const frame = store.frame(".eva/scratch/chart.html", theme);
    if (frame.state !== "ready") throw new Error("The page is not ready.");
    for (const path of [
      "",
      "other.html",
      "../other.html",
      "config.json",
      "data/x.json",
      "eva/theme.css/x",
      "PAGE.html",
    ])
      expect(store.serve(frame.token, path, "GET")?.status).toBe(404);
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"])
      expect(store.serve(frame.token, "page.html", method)?.status).toBe(405);
  });

  test("checks the file again at each request", () => {
    write(".eva/scratch/chart.html", page);
    const store = pages();
    const frame = store.frame(".eva/scratch/chart.html", theme);
    if (frame.state !== "ready") throw new Error("The page is not ready.");
    write(".eva/scratch/chart.html", "<p>ghp_abcdefghijklmnopqrstuvwxyz0123456789</p>");
    expect(store.serve(frame.token, "page.html", "GET")?.status).toBe(404);
    rmSync(join(vault, ".eva", "scratch", "chart.html"));
    expect(store.serve(frame.token, "page.html", "GET")?.status).toBe(404);
  });

  test("ends a token after its life, and after a release", () => {
    write(".eva/scratch/chart.html", page);
    const store = pages();
    const first = store.frame(".eva/scratch/chart.html", theme);
    const second = store.frame(".eva/scratch/chart.html", theme);
    if (first.state !== "ready" || second.state !== "ready") throw new Error("The page is not ready.");
    expect(first.token).not.toBe(second.token);
    store.release([first.token, "unknown"]);
    expect(store.has(first.token)).toBe(false);
    expect(store.serve(first.token, "page.html", "GET")).toBeNull();
    now += pageTokenLifeMs;
    expect(store.serve(second.token, "page.html", "GET")).toBeNull();
    expect(store.has(second.token)).toBe(false);
  });

  test("keeps at most the newest tokens", () => {
    write(".eva/scratch/chart.html", page);
    const store = pages();
    const tokens: string[] = [];
    for (let index = 0; index <= maxPageTokens; index += 1) {
      const frame = store.frame(".eva/scratch/chart.html", theme);
      if (frame.state === "ready") tokens.push(frame.token);
    }
    expect(store.has(tokens[0] ?? "")).toBe(false);
    expect(store.has(tokens[1] ?? "")).toBe(true);
    expect(store.has(tokens.at(-1) ?? "")).toBe(true);
  });

  test("knows no token of a widget", () => {
    expect(pages().has("a".repeat(43))).toBe(false);
    expect(pages().serve("a".repeat(43), "page.html", "GET")).toBeNull();
  });
});
