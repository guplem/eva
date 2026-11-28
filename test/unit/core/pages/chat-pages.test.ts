import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ChatPages,
  maxPageBytes,
  maxPageTokens,
  pageTokenLifeMs,
  resolveShownPage,
  savedPathOf,
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

  test("gives the 2 MB note for every file above the page limit, also one above 50 MB", () => {
    write(".eva/scratch/huge.html", "");
    truncateSync(join(vault, ".eva", "scratch", "huge.html"), 60 * 1024 * 1024);
    expect(resolveShownPage(vault, ".eva/scratch/huge.html")).toEqual({
      state: "too-large",
      reason: ".eva/scratch/huge.html is larger than 2 MB.",
    });
  });

  test("gives an encrypted page a reason of its own, with no Files page", () => {
    write(
      ".eva/scratch/sealed.html",
      "Encrypted by Eva. Open this file in Eva's Files page to read it.\neva-encrypted-v1 0123456789abcdef\nAAAA\n",
    );
    expect(resolveShownPage(vault, ".eva/scratch/sealed.html")).toEqual({
      state: "refused",
      reason: ".eva/scratch/sealed.html is encrypted, so Eva does not show it.",
    });
  });

  test("says why it does not show a page, with the word show", () => {
    write(".eva/scratch/keys.html", "<p>ghp_abcdefghijklmnopqrstuvwxyz0123456789</p>");
    expect(resolveShownPage(vault, ".eva/scratch/keys.html")).toEqual({
      state: "refused",
      reason: ".eva/scratch/keys.html holds a secret, so Eva does not show it.",
    });
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

describe("resolveShownPage and saved pages (#1130)", () => {
  test("says how a page is kept: temporary in the scratch folder, saved in .eva/pages, or a note", () => {
    write(".eva/scratch/chart.html", page);
    write(".eva/pages/kept.html", page);
    write("Notes/Old.html", page);
    expect(resolveShownPage(vault, ".eva/scratch/chart.html")).toMatchObject({ state: "ready", kept: "temporary" });
    expect(resolveShownPage(vault, ".eva/pages/kept.html")).toMatchObject({ state: "ready", kept: "saved" });
    expect(resolveShownPage(vault, "Notes/Old.html")).toMatchObject({ state: "ready", kept: "note" });
  });

  test("leads the scratch marker of a saved page to the saved file once the scratch file is gone", () => {
    write(".eva/pages/chart.html", page);
    expect(resolveShownPage(vault, ".eva/scratch/chart.html")).toMatchObject({
      state: "ready",
      relativePath: ".eva/pages/chart.html",
      kept: "saved",
    });
  });

  test("shows a scratch file that exists at the marker: it is the newest version, and not saved", () => {
    write(".eva/scratch/chart.html", "<p>new</p>");
    write(".eva/pages/chart.html", page);
    expect(resolveShownPage(vault, ".eva/scratch/chart.html")).toMatchObject({
      relativePath: ".eva/scratch/chart.html",
      kept: "temporary",
    });
    // A pin names the saved path, and shows the newest version of the same name too.
    expect(resolveShownPage(vault, ".eva/pages/chart.html")).toMatchObject({
      relativePath: ".eva/scratch/chart.html",
      kept: "temporary",
    });
  });

  test("keeps pages of different scratch folders apart, also the files that the person sends", () => {
    write(".eva/pages/a/chart.html", page);
    write(".eva/scratch/b/chart.html", page);
    write(".eva/pages/report.html", page);
    write(".eva/scratch/received/report.html", "<p>sent</p>");
    expect(resolveShownPage(vault, ".eva/scratch/a/chart.html")).toMatchObject({
      relativePath: ".eva/pages/a/chart.html",
    });
    expect(resolveShownPage(vault, ".eva/scratch/b/chart.html")).toMatchObject({
      relativePath: ".eva/scratch/b/chart.html",
    });
    expect(resolveShownPage(vault, ".eva/scratch/received/report.html")).toMatchObject({
      relativePath: ".eva/scratch/received/report.html",
    });
    expect(resolveShownPage(vault, ".eva/scratch/c/chart.html").state).toBe("gone");
  });

  test("gives the reason of a saved page that it refuses, and its saved path, so the person can remove it", () => {
    write(".eva/pages/keys.html", "<p>ghp_abcdefghijklmnopqrstuvwxyz0123456789</p>");
    expect(resolveShownPage(vault, ".eva/scratch/keys.html")).toMatchObject({
      state: "refused",
      saved: ".eva/pages/keys.html",
    });
    write(".eva/scratch/secret.html", "<p>ghp_abcdefghijklmnopqrstuvwxyz0123456789</p>");
    expect(resolveShownPage(vault, ".eva/scratch/secret.html")).not.toHaveProperty("saved");
  });

  test("shows the saved page when the scratch version is a folder or a file that Eva refuses", () => {
    write(".eva/pages/folder.html", page);
    mkdirSync(join(vault, ".eva", "scratch", "folder.html"), { recursive: true });
    expect(resolveShownPage(vault, ".eva/scratch/folder.html")).toMatchObject({
      state: "ready",
      relativePath: ".eva/pages/folder.html",
      kept: "saved",
    });
    write(".eva/pages/leak.html", page);
    write(".eva/scratch/leak.html", "<p>ghp_abcdefghijklmnopqrstuvwxyz0123456789</p>");
    expect(resolveShownPage(vault, ".eva/scratch/leak.html")).toMatchObject({
      state: "ready",
      relativePath: ".eva/pages/leak.html",
    });
    // With no saved version, the refusal of the scratch version stands.
    write(".eva/scratch/alone.html", "<p>ghp_abcdefghijklmnopqrstuvwxyz0123456789</p>");
    expect(resolveShownPage(vault, ".eva/scratch/alone.html")).toMatchObject({ state: "refused" });
  });

  test("reads the old Scratch folder with a pages subfolder as scratch", () => {
    write("Scratch/pages/chart.html", page);
    expect(resolveShownPage(vault, "Scratch/pages/chart.html")).toMatchObject({
      state: "ready",
      relativePath: "Scratch/pages/chart.html",
      kept: "temporary",
    });
  });

  test("names the saved file of a page by its whole path under the scratch folder", () => {
    expect(savedPathOf(vault, ".eva/scratch/plan.html")).toBe(".eva/pages/plan.html");
    expect(savedPathOf(vault, ".eva/scratch/received/plan.html")).toBe(".eva/pages/received/plan.html");
    expect(savedPathOf(vault, "Scratch/plan.html")).toBe(".eva/pages/plan.html");
    expect(savedPathOf(vault, ".eva/pages/a/plan.html")).toBe(".eva/pages/a/plan.html");
    expect(savedPathOf(vault, "Notes/plan.html")).toBeNull();
    expect(savedPathOf(vault, ".eva/scratch")).toBeNull();
  });
});

describe("ChatPages", () => {
  test("tells the frame how its page is kept and which file it shows", () => {
    write(".eva/pages/chart.html", page);
    expect(pages().frame(".eva/scratch/chart.html", theme)).toMatchObject({
      state: "ready",
      kept: "saved",
      path: ".eva/pages/chart.html",
      saved: ".eva/pages/chart.html",
    });
    write("Notes/plan.html", page);
    expect(pages().frame("Notes/plan.html", theme)).toMatchObject({ kept: "note", saved: null });
  });

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

  test("says at the frame's load whether its token served the page, and ends the token", () => {
    write(".eva/scratch/chart.html", page);
    const store = pages();
    const served = store.frame(".eva/scratch/chart.html", theme);
    const unused = store.frame(".eva/scratch/chart.html", theme);
    const late = store.frame(".eva/scratch/chart.html", theme);
    if (served.state !== "ready" || unused.state !== "ready" || late.state !== "ready")
      throw new Error("The page is not ready.");
    store.serve(served.token, "eva/theme.css", "GET");
    expect(store.loaded(served.token)).toBe(false);
    expect(store.has(served.token)).toBe(false);
    const again = store.frame(".eva/scratch/chart.html", theme);
    if (again.state !== "ready") throw new Error("The page is not ready.");
    store.serve(again.token, "page.html", "GET");
    expect(store.loaded(again.token)).toBe(true);
    expect(store.loaded(again.token)).toBe(false);
    store.serve(unused.token, "page.html", "HEAD");
    expect(store.loaded(unused.token)).toBe(false);
    now += pageTokenLifeMs;
    store.serve(late.token, "page.html", "GET");
    expect(store.loaded(late.token)).toBe(false);
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
