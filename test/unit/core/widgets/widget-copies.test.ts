import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { widgetAddress } from "../../../../src/core/widgets/widget-address.ts";
import { WidgetCopies } from "../../../../src/core/widgets/widget-copies.ts";
import { isEvaError } from "../../../../src/shared/errors.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { createGitSandbox, gitEnvironment, gitHookTimeoutMs, type GitSandbox } from "../../../support/git-sandbox.ts";

let sandbox: GitSandbox;
let work: string;
let folder: string;
let copies: WidgetCopies;
const address = widgetAddress("Example-Owner/Habits")!;

function commit(files: Readonly<Record<string, string>>, message: string): string {
  for (const [path, content] of Object.entries(files)) sandbox.write(work, path, content);
  sandbox.git(work, "add", "-A");
  sandbox.git(work, "commit", "-q", "-m", message);
  sandbox.git(work, "push", "-q", "origin", "main");
  return sandbox.git(work, "rev-parse", "HEAD");
}

function text(body: string | Uint8Array | undefined): string {
  return typeof body === "string" ? body : Buffer.from(body ?? new Uint8Array()).toString();
}

beforeEach(() => {
  sandbox = createGitSandbox();
  work = sandbox.clone("work");
  folder = mkdtempSync(join(tmpdir(), "eva-widget-copies-"));
  copies = new WidgetCopies({
    folder,
    runner: systemProcessRunner,
    environment: gitEnvironment,
    remoteOf: () => sandbox.remote,
  });
}, gitHookTimeoutMs);

afterEach(() => {
  sandbox.dispose();
  rmSync(folder, { recursive: true, force: true });
});

describe("WidgetCopies", () => {
  test("a review fetches one commit and reads its files, with nothing checked out", async () => {
    const first = commit({ "eva-widget.json": '{"name":"One"}', "index.html": "<p>one</p>" }, "one");
    expect(await copies.fetchNewest(address)).toBe(first);
    expect(copies.folderOf(address)).toBe(join(folder, "example-owner", "habits"));
    expect(await copies.readAt(address, first, "eva-widget.json")).toBe('{"name":"One"}');
    expect(await copies.readAt(address, first, "missing.json")).toBeNull();
    expect(await copies.readAt(address, "HEAD", "eva-widget.json")).toBeNull();
    expect(existsSync(join(copies.folderOf(address), "index.html"))).toBe(false);
    expect(copies.serveFile(address, "index.html").status).toBe(404);
  });

  test("the approval installs exactly the approved commit, also after a newer one", async () => {
    const first = commit({ "eva-widget.json": "{}", "index.html": "<p>one</p>", "js/main.js": "1" }, "one");
    await copies.fetchNewest(address);
    const second = commit({ "index.html": "<p>two</p>" }, "two");
    expect(await copies.fetchNewest(address)).toBe(second);
    await copies.install(address, first);
    const page = copies.serveFile(address, "index.html");
    expect(page.status).toBe(200);
    expect(page.contentType).toBe("text/html; charset=utf-8");
    expect(text(page.body)).toBe("<p>one</p>");
    expect(copies.serveFile(address, "js/main.js").contentType).toBe("text/javascript; charset=utf-8");
    await copies.install(address, second);
    expect(text(copies.serveFile(address, "index.html").body)).toBe("<p>two</p>");
    expect(String(await copies.install(address, "main").catch((error: unknown) => error))).toContain("not a commit");
    const failure = await copies.install(address, "b".repeat(40)).catch((error: unknown) => error);
    expect(isEvaError(failure, "git_failed")).toBe(true);
  });

  test("never serves git data, a hidden file, a folder or a link", async () => {
    const first = commit({ "index.html": "x", ".secret": "x", "assets/a.css": "a" }, "one");
    await copies.fetchNewest(address);
    await copies.install(address, first);
    for (const path of [".git/config", ".secret", "assets", "assets/", "../x", "", "a//b", "missing.js"]) {
      expect({ path, status: copies.serveFile(address, path).status }).toEqual({ path, status: 404 });
    }
    expect(copies.serveFile(address, "assets/a.css").contentType).toBe("text/css; charset=utf-8");
    try {
      symlinkSync(join(folder, ".."), join(copies.folderOf(address), "up"), "junction");
    } catch {
      return; // A system that cannot make the link cannot follow one either.
    }
    expect(copies.serveFile(address, "up/anything").status).toBe(404);
  });

  test("a failed fetch names the address, and a removal leaves no folder", async () => {
    const broken = new WidgetCopies({
      folder,
      runner: systemProcessRunner,
      environment: gitEnvironment,
      remoteOf: () => join(folder, "no-such-remote"),
    });
    expect(String(await broken.fetchNewest(address).catch((error: unknown) => error))).toContain(
      "https://github.com/Example-Owner/Habits",
    );
    copies.remove(address);
    expect(existsSync(copies.folderOf(address))).toBe(false);
  });
});
