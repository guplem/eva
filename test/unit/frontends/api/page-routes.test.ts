/**
 * The page routes of the local API (#1129): the token of a page frame, which needs the login, and
 * the page itself, which a sandboxed frame loads with no cookie.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Eva } from "../../../../src/core/eva.ts";
import { pagePolicy } from "../../../../src/core/pages/page-policy.ts";
import { defaultConfig, homePaths } from "../../../../src/core/settings/home.ts";
import { widgetPolicy } from "../../../../src/core/widgets/widget-policy.ts";
import { startLocalApi, type LocalApi } from "../../../../src/frontends/api/local-api.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { FakeEngine } from "../../../support/fake-engine.ts";
import { gitEnvironment } from "../../../support/git-sandbox.ts";

const token = "page-routes-token-for-tests";
const chart = "<!doctype html><link rel=stylesheet href=eva/theme.css><p>chart</p>";

let home: string;
let vault: string;
let eva: Eva;
let api: LocalApi;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "eva-page-routes-"));
  vault = join(home, "vault");
  for (const [path, content] of Object.entries({
    ".eva/assistant.md": "# You are Eva\n",
    ".eva/scratch/chart.html": chart,
    "Notes/plan.md": "# Plan\n",
  })) {
    mkdirSync(dirname(join(vault, path)), { recursive: true });
    writeFileSync(join(vault, path), content);
  }
  eva = new Eva({
    paths: homePaths(home),
    config: { ...defaultConfig, vaultPath: vault, timeZone: "UTC", sync: { ...defaultConfig.sync, enabled: false } },
    secrets: {},
    engines: [new FakeEngine((request) => FakeEngine.answer(request, "answer"))],
    runner: systemProcessRunner,
    processEnvironment: gitEnvironment,
    now: () => new Date("2026-10-14T10:30:00Z"),
    basePrompt: "Base.",
    baseWidgets: [],
    githubRequest: () => Promise.resolve({ status: 404, body: "" }),
  });
  api = startLocalApi({ eva, port: 0, token, extraHosts: [], allowedTailscaleIdentities: [] });
});

afterEach(async () => {
  await eva.idle();
  api.stop();
  eva.stop();
  rmSync(home, { recursive: true, force: true });
});

function call(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${api.url}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** A request as a sandboxed frame sends it: no cookie, no login, and `Origin: null`. */
function frameCall(path: string, method = "GET", extra: Record<string, string> = {}): Promise<Response> {
  return fetch(`${api.url}${path}`, { method, headers: { origin: "null", "sec-fetch-dest": "iframe", ...extra } });
}

interface Frame {
  readonly state: string;
  readonly src?: string;
  readonly token?: string;
  readonly reason?: string;
}

async function frameOf(path: string): Promise<Frame> {
  return (await (
    await call("/api/pages/frame", { path, scheme: "dark", colors: { "--accent": "#123456" } })
  ).json()) as Frame;
}

describe("the token of a page frame", () => {
  test("needs the login", async () => {
    const refused = await fetch(`${api.url}/api/pages/frame`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: ".eva/scratch/chart.html", scheme: "light" }),
    });
    expect(refused.status).toBe(401);
    expect(
      (await call("/api/pages/frame", { path: ".eva/scratch/chart.html", scheme: "light" }, { origin: "null" })).status,
    ).toBe(403);
  });

  test("gives a token path, or the note of a page that Eva cannot show", async () => {
    const frame = await frameOf(".eva/scratch/chart.html");
    expect(frame.state).toBe("ready");
    expect(frame.src).toBe(`/widgets/${frame.token ?? ""}/page.html`);
    expect(await frameOf(".eva/scratch/old.html")).toMatchObject({ state: "gone" });
    expect(await frameOf("Notes/plan.md")).toMatchObject({ state: "refused" });
    writeFileSync(join(home, "outside.html"), chart);
    expect(await frameOf("../outside.html")).toMatchObject({ state: "refused" });
    expect((await call("/api/pages/frame", { path: "" })).status).toBe(400);
  });
});

describe("the page files", () => {
  test("serve the page with its own policy and no network, and the theme", async () => {
    const frame = await frameOf(".eva/scratch/chart.html");
    const src = frame.src ?? "";
    const page = await frameCall(src);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(chart);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const base = `${api.url}/widgets/${frame.token ?? ""}/`;
    expect(page.headers.get("content-security-policy")).toBe(pagePolicy(base, api.url));
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("access-control-allow-origin")).toBeNull();
    expect(page.headers.get("set-cookie")).toBeNull();
    const theme = await frameCall(`/widgets/${frame.token ?? ""}/eva/theme.css`);
    expect(await theme.text()).toContain("--accent: #123456;");
    expect(theme.headers.get("content-security-policy")).toBe(pagePolicy(base, api.url));
  });

  test("refuse a page of its own, another site, a write, and another path", async () => {
    const frame = await frameOf(".eva/scratch/chart.html");
    const src = frame.src ?? "";
    expect((await frameCall(src, "GET", { "sec-fetch-dest": "document" })).status).toBe(403);
    expect((await frameCall(src, "GET", { origin: "https://evil.example" })).status).toBe(403);
    expect((await frameCall(src, "GET", { host: "evil.example" })).status).toBe(403);
    expect((await frameCall(src, "POST")).status).toBe(405);
    expect((await frameCall(src, "OPTIONS")).status).toBe(405);
    expect((await frameCall(`/widgets/${frame.token ?? ""}/index.html`)).status).toBe(404);
    expect((await frameCall(`/widgets/${frame.token ?? ""}/%2e%2e/Notes/plan.md`)).status).toBe(404);
    expect((await frameCall(`/widgets/${frame.token ?? ""}/%E0`)).status).toBe(400);
  });

  test("say at the frame's load whether the token served the page", async () => {
    const frame = await frameOf(".eva/scratch/chart.html");
    const loaded = async (): Promise<unknown> =>
      (await call("/api/pages/loaded", { token: frame.token })).json() as Promise<unknown>;
    await frameCall(frame.src ?? "");
    expect(await loaded()).toEqual({ served: true });
    expect(await loaded()).toEqual({ served: false });
    expect((await frameCall(frame.src ?? "")).status).toBe(404);
  });

  test("stop when the page releases the token, and keep the policy of a widget for every other token", async () => {
    const frame = await frameOf(".eva/scratch/chart.html");
    const released = await call("/api/pages/release", { tokens: [frame.token] });
    expect(released.status).toBe(204);
    const gone = await frameCall(frame.src ?? "");
    expect(gone.status).toBe(404);
    const base = `${api.url}/widgets/${frame.token ?? ""}/`;
    expect(gone.headers.get("content-security-policy")).toBe(widgetPolicy(base, api.url, []));
  });
});

describe("Save, Remove and Pin (#1130)", () => {
  test("save a page to .eva/pages, and the old marker shows the saved file", async () => {
    const saved = await call("/api/pages/save", { path: ".eva/scratch/chart.html" });
    expect(await saved.json()).toEqual({ path: ".eva/pages/chart.html" });
    expect(existsSync(join(vault, ".eva", "pages", "chart.html"))).toBe(true);
    expect(await frameOf(".eva/scratch/chart.html")).toMatchObject({
      state: "ready",
      kept: "saved",
      path: ".eva/pages/chart.html",
    });
    expect((await call("/api/pages/save", { path: ".eva/scratch/old.html" })).status).toBe(404);
    const refused = await fetch(`${api.url}/api/pages/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: ".eva/scratch/chart.html" }),
    });
    expect(refused.status).toBe(401);
  });

  test("pin saves the page, and remove unpins and deletes it", async () => {
    const chat = eva.createAssistantSession({ source: "web" });
    const pinned = await call(`/api/sessions/${chat.id}/pin`, { path: ".eva/scratch/chart.html" });
    expect(await pinned.json()).toMatchObject({ pinnedPage: ".eva/pages/chart.html" });
    expect(eva.sessions.get(chat.id).pinnedPage).toBe(".eva/pages/chart.html");
    const removed = await call("/api/pages/remove", { path: ".eva/scratch/chart.html" });
    expect(await removed.json()).toEqual({ path: ".eva/pages/chart.html" });
    expect(eva.sessions.get(chat.id).pinnedPage).toBeNull();
    expect(await frameOf(".eva/scratch/chart.html")).toMatchObject({ state: "gone" });
    // Unpin keeps the file.
    writeFileSync(join(vault, ".eva", "pages", "kept.html"), chart);
    await call(`/api/sessions/${chat.id}/pin`, { path: ".eva/pages/kept.html" });
    const unpinned = await call(`/api/sessions/${chat.id}/pin`, { path: null });
    expect(await unpinned.json()).toMatchObject({ pinnedPage: null });
    expect(existsSync(join(vault, ".eva", "pages", "kept.html"))).toBe(true);
  });

  test("refuse to remove a page that is not saved, and a note", async () => {
    expect((await call("/api/pages/remove", { path: ".eva/scratch/chart.html" })).status).toBe(404);
    expect((await call("/api/pages/remove", { path: "Notes/plan.md" })).status).toBe(409);
    expect(existsSync(join(vault, ".eva", "scratch", "chart.html"))).toBe(true);
  });

  /** Every entry of the vault, with link targets and file bytes, so a test sees that a refused pin changed nothing. */
  function vaultEntries(): string[] {
    const entries: string[] = [];
    const walk = (path: string): void => {
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) entries.push(`${path} -> ${readlinkSync(path)}`);
      else if (stats.isDirectory()) for (const name of readdirSync(path).sort()) walk(join(path, name));
      else entries.push(`${path} = ${readFileSync(path, "utf8")}`);
    };
    walk(vault);
    return entries;
  }

  test.skipIf(process.platform === "win32")(
    "Pin never saves, or deletes, a note that a link in the scratch folder names",
    async () => {
      const chat = eva.createAssistantSession({ source: "web" });
      writeFileSync(join(vault, "Notes", "important.html"), chart);
      writeFileSync(join(vault, "Notes", "b.html"), chart);
      symlinkSync(join(vault, "Notes"), join(vault, ".eva", "scratch", "sub"));
      symlinkSync(join(vault, "Notes", "b.html"), join(vault, ".eva", "scratch", "x.html"));
      const before = vaultEntries();
      for (const path of [".eva/pages/sub/important.html", ".eva/pages/x.html"]) {
        const pinned = await call(`/api/sessions/${chat.id}/pin`, { path });
        expect(pinned.status).toBe(404);
      }
      expect(vaultEntries()).toEqual(before);
      expect(eva.sessions.get(chat.id).pinnedPage).toBeNull();
    },
  );
});
