/**
 * The widget routes of the local API (#691): the settings list, the grid's tokens, and the files
 * of a sandboxed widget, which come with `Origin: null` and no cookie.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Eva } from "../../../../src/core/eva.ts";
import { defaultConfig, homePaths } from "../../../../src/core/settings/home.ts";
import { startLocalApi, type LocalApi } from "../../../../src/frontends/api/local-api.ts";
import { systemProcessRunner } from "../../../../src/shared/process-runner.ts";
import { FakeEngine } from "../../../support/fake-engine.ts";
import { createGitSandbox, gitEnvironment, gitHookTimeoutMs, type GitSandbox } from "../../../support/git-sandbox.ts";

const token = "widget-routes-token-for-tests";
const id = "example-owner/habits";
const manifest = {
  contract: 1,
  name: "Habits",
  size: "medium",
  inputs: [
    {
      id: "habits",
      type: "folder",
      label: "Habits folder",
      description: "One file for each habit.",
      why: "The widget shows and checks your habits.",
      required: true,
      access: "write",
      schema: "schemas/habits.json",
      files: "*.json",
    },
  ],
  hosts: [{ url: "https://api.example.com", why: "The widget reads the weather." }],
};

let sandbox: GitSandbox;
let home: string;
let vault: string;
let eva: Eva;
let api: LocalApi;

function evaWith(vaultPath: string | null): Eva {
  return new Eva({
    paths: homePaths(home),
    config: { ...defaultConfig, vaultPath, timeZone: "UTC", sync: { ...defaultConfig.sync, enabled: false } },
    secrets: {},
    engines: [new FakeEngine((request) => FakeEngine.answer(request, "answer"))],
    runner: systemProcessRunner,
    processEnvironment: gitEnvironment,
    now: () => new Date("2026-10-14T10:30:00Z"),
    basePrompt: "Base.",
    widgetRemote: () => sandbox.remote,
  });
}

function call(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  return fetch(`${api.url}${path}`, {
    method: init.method ?? "GET",
    headers: init.headers ?? { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) }),
  });
}

/** A request as a sandboxed frame sends it: no cookie, no login, and `Origin: null`. */
function frameCall(path: string, method = "GET", body?: string, extra: Record<string, string> = {}): Promise<Response> {
  return fetch(`${api.url}${path}`, {
    method,
    headers: { origin: "null", "sec-fetch-dest": "empty", ...extra },
    ...(body === undefined ? {} : { body }),
  });
}

async function approvedSrc(): Promise<string> {
  expect((await call("/api/widgets", { method: "POST", body: { repository: "Example-Owner/Habits" } })).status).toBe(
    201,
  );
  const review = (await (await call(`/api/widgets/${id}/review`)).json()) as { commit: string };
  const approved = await call(`/api/widgets/${id}/approve`, {
    method: "POST",
    body: { commit: review.commit, values: { habits: "Life/Habits" } },
  });
  if (approved.status !== 200) throw new Error(await approved.text());
  const frames = (await (
    await call("/api/widgets/frames", { method: "POST", body: { scheme: "dark", colors: { "--bg": "#000000" } } })
  ).json()) as { src: string; token: string }[];
  const src = frames[0]?.src;
  if (src === undefined) throw new Error("The widget must have a frame.");
  return src;
}

beforeEach(() => {
  sandbox = createGitSandbox();
  const work = sandbox.clone("work");
  for (const [path, content] of Object.entries({
    "eva-widget.json": JSON.stringify(manifest),
    "schemas/habits.json": JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { name: { type: "string" }, checks: { type: "array" } },
    }),
    "index.html": "<p>habits</p>",
    "main.js": "console.log(1);",
  }))
    sandbox.write(work, path, content);
  sandbox.git(work, "add", "-A");
  sandbox.git(work, "commit", "-q", "-m", "widget");
  sandbox.git(work, "push", "-q", "origin", "main");
  home = mkdtempSync(join(tmpdir(), "eva-widget-routes-"));
  vault = join(home, "vault");
  for (const [path, content] of Object.entries({
    "Life/Habits/walk.json": JSON.stringify({ name: "Walk", checks: [], streak: 2 }),
    "Life/About me.md": "# About me\n",
    ".eva/assistant.md": "# You are Eva\n",
  })) {
    mkdirSync(dirname(join(vault, path)), { recursive: true });
    writeFileSync(join(vault, path), content);
  }
  eva = evaWith(vault);
  api = startLocalApi({
    eva,
    port: 0,
    token,
    extraHosts: ["eva.example-tailnet.ts.net"],
    allowedTailscaleIdentities: [],
  });
}, gitHookTimeoutMs);

afterEach(async () => {
  await eva.idle();
  api.stop();
  eva.stop();
  sandbox.dispose();
  rmSync(home, { recursive: true, force: true });
}, gitHookTimeoutMs);

describe("the widget list", () => {
  test("needs the login, like every API route", async () => {
    expect((await call("/api/widgets", { headers: {} })).status).toBe(401);
  });

  test("adds, checks, approves, moves, turns off and removes a widget", async () => {
    await approvedSrc();
    const listed = (await (await call("/api/widgets")).json()) as { id: string; state: string }[];
    expect(listed.map((item) => [item.id, item.state])).toEqual([[id, "on"]]);
    const checked = (await (await call("/api/widgets/check", { method: "POST" })).json()) as { problems: unknown }[];
    expect(checked[0]?.problems).toEqual([]);
    expect((await call(`/api/widgets/${id}/move`, { method: "POST", body: { direction: "up" } })).status).toBe(200);
    expect((await call(`/api/widgets/${id}/enabled`, { method: "PUT", body: { enabled: false } })).status).toBe(200);
    expect((await call(`/api/widgets/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(JSON.parse(readFileSync(join(vault, ".eva/widgets.json"), "utf-8"))).toEqual({ version: 1, widgets: [] });
    expect(existsSync(join(vault, "Life/Habits/walk.json"))).toBe(true);
  });

  test("answers each refusal with its status and code", async () => {
    const bad = await call("/api/widgets", { method: "POST", body: { repository: "not an address" } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe("widget_invalid");
    expect((await call("/api/widgets/example-owner/unknown/review")).status).toBe(404);
    await call("/api/widgets", { method: "POST", body: { repository: "example-owner/other" } });
    const needs = await call("/api/widgets/example-owner/other/enabled", { method: "PUT", body: { enabled: true } });
    expect(needs.status).toBe(409);
    expect(((await needs.json()) as { code: string }).code).toBe("widget_needs_approval");
    expect((await call("/api/widgets/example-owner/other/unknown", { method: "POST", body: {} })).status).toBe(404);
    expect((await call("/api/widgets/a/b/c/d")).status).toBe(404);
  });

  test("refuses Origin: null on every route but the widget files", async () => {
    for (const path of ["/api/widgets", "/api/status", "/api/login/device"]) {
      const response = await fetch(`${api.url}${path}`, {
        method: path === "/api/login/device" ? "POST" : "GET",
        headers: { authorization: `Bearer ${token}`, origin: "null" },
      });
      expect({ path, status: response.status }).toEqual({ path, status: 403 });
    }
  });
});

describe("the widget files", () => {
  test("serve the approved widget with its policy, no referrer and no cookie", async () => {
    const src = await approvedSrc();
    const page = await frameCall(`${src}?size=medium`);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("<p>habits</p>");
    const policy = page.headers.get("content-security-policy") ?? "";
    const base = `${api.url}${src.replace(/index\.html$/, "")}`;
    expect(policy).toContain("sandbox allow-scripts");
    expect(policy).toContain(`connect-src ${base} https://api.example.com`);
    expect(policy).toContain(`frame-ancestors ${api.url}`);
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("access-control-allow-origin")).toBe("null");
    expect(page.headers.get("set-cookie")).toBeNull();
    const head = await frameCall(src, "HEAD");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("answer a preflight, and write the approved folder", async () => {
    const src = await approvedSrc();
    const base = src.replace(/index\.html$/, "");
    const preflight = await frameCall(`${base}data/habits/walk.json`, "OPTIONS");
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, PUT, DELETE");
    const write = await frameCall(
      `${base}data/habits/walk.json`,
      "PUT",
      JSON.stringify({ name: "Walk", checks: [{ date: "2026-10-14" }] }),
    );
    expect(write.status).toBe(204);
    expect(JSON.parse(readFileSync(join(vault, "Life/Habits/walk.json"), "utf-8"))).toMatchObject({ streak: 2 });
    expect((await frameCall(`${base}data/habits/AGENTS.md`, "PUT", "# Rules")).status).toBe(403);
    const large = await frameCall(`${base}data/habits/big.json`, "PUT", "x".repeat(5 * 1024 * 1024 + 1));
    expect(large.status).toBe(413);
    expect((await frameCall(`${base}data/habits/%2e%2e/About%20me.md`)).status).toBe(404);
    expect((await frameCall(`${base}data/habits/%E0`)).status).toBe(400);
    expect(await (await frameCall(`${base}eva/theme.css`)).text()).toContain("--bg: #000000;");
  });

  test("stop a body at the limit, also with no length, and read none for a dead token", async () => {
    const src = await approvedSrc();
    const base = src.replace(/index\.html$/, "");
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 6; index += 1) controller.enqueue(chunk);
        controller.close();
      },
    });
    const chunked = await fetch(`${api.url}${base}data/habits/big.json`, {
      method: "PUT",
      headers: { origin: "null" },
      body: stream,
    });
    expect(chunked.status).toBe(413);
    const dead = await frameCall(`/widgets/${"b".repeat(43)}/data/habits/x.json`, "PUT", "{}");
    expect(dead.status).toBe(404);
    const empty = await fetch(`${api.url}${base}data/habits/empty.json`, {
      method: "PUT",
      headers: { origin: "null" },
    });
    expect(empty.status).toBe(400);
  });

  test("refuse a page of its own, another site, an unknown host and an unknown token", async () => {
    const src = await approvedSrc();
    expect((await frameCall(src, "GET", undefined, { "sec-fetch-dest": "document" })).status).toBe(403);
    expect((await frameCall(src, "GET", undefined, { origin: "https://evil.example" })).status).toBe(403);
    expect((await frameCall(src, "GET", undefined, { host: "evil.example" })).status).toBe(403);
    expect((await frameCall(`/widgets/${"a".repeat(43)}/index.html`)).status).toBe(404);
    expect((await frameCall(`/widgets/${"a".repeat(43)}/index.html`, "OPTIONS")).status).toBe(404);
    expect((await frameCall("/widgets/short/index.html")).status).toBe(404);
    // A request with no Origin, such as the frame's own page load, passes.
    expect((await fetch(`${api.url}${src}`)).status).toBe(200);
  });

  test("stop at once when the widget turns off or the page releases the token", async () => {
    const src = await approvedSrc();
    const tokenOf = src.split("/")[2] ?? "";
    expect((await call("/api/widgets/frames/release", { method: "POST", body: { tokens: [tokenOf] } })).status).toBe(
      204,
    );
    expect((await frameCall(src)).status).toBe(404);
    const again = (await (await call("/api/widgets/frames", { method: "POST", body: { scheme: "light" } })).json()) as {
      src: string;
    }[];
    const next = again[0]?.src ?? "";
    expect((await frameCall(next)).status).toBe(200);
    await call(`/api/widgets/${id}/enabled`, { method: "PUT", body: { enabled: false } });
    expect((await frameCall(next)).status).toBe(404);
  });
});

describe("without a vault", () => {
  test("the list says so, and a widget path answers nothing", async () => {
    api.stop();
    eva.stop();
    eva = evaWith(null);
    api = startLocalApi({ eva, port: 0, token, extraHosts: [], allowedTailscaleIdentities: [] });
    expect((await call("/api/widgets")).status).toBe(409);
    expect((await frameCall(`/widgets/${"a".repeat(43)}/index.html`)).status).toBe(404);
  });
});
